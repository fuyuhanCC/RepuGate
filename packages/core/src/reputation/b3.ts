import type {
  FeedbackEvaluation,
  FeedbackRejectionReason,
  ReputationAssessment,
  ReputationRiskFlag,
} from "../domain/evaluation";
import type {
  PaymentProofVerification,
  PaymentProofVerifier,
  ReceiptUsageReader,
} from "../domain/evidence";
import type { FeedbackRecord } from "../domain/reputation";
import type { IdentitySnapshot } from "../domain/types";
import {
  createAuthorizationKey,
  createReceiptKey,
} from "../evidence/receipt-key";
import {
  averageScoreBps,
  confidenceFromDistinctReviewers,
} from "./fixed-point";
import {
  filterQualityFeedback,
  type QualityFeedbackCandidate,
  type QualityFeedbackScope,
} from "./quality-feedback";

export interface B3AssessmentInput {
  feedback: readonly FeedbackRecord[];
  identity: IdentitySnapshot;
  scope: QualityFeedbackScope;
  paymentProofVerifier: PaymentProofVerifier;
  receiptUsageReader?: ReceiptUsageReader;
  reviewersForFullConfidence?: number;
}

interface CandidateVerification {
  candidate: QualityFeedbackCandidate;
  verification?: PaymentProofVerification;
  verifierError?: string;
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sortCandidates(
  candidates: readonly QualityFeedbackCandidate[],
): QualityFeedbackCandidate[] {
  return [...candidates].sort((left, right) => {
    if (left.feedback.observedAtBlock !== right.feedback.observedAtBlock) {
      return left.feedback.observedAtBlock < right.feedback.observedAtBlock
        ? -1
        : 1;
    }

    if (left.feedback.feedbackIndex !== right.feedback.feedbackIndex) {
      return left.feedback.feedbackIndex < right.feedback.feedbackIndex ? -1 : 1;
    }

    return left.feedbackKey.localeCompare(right.feedbackKey);
  });
}

function rejectCandidate(
  candidate: QualityFeedbackCandidate,
  reason: FeedbackRejectionReason,
  detail?: string,
): FeedbackEvaluation {
  return {
    feedbackKey: candidate.feedbackKey,
    clientAddress: candidate.feedback.clientAddress,
    status: "REJECTED",
    reason,
    ...(detail === undefined ? {} : { detail }),
  };
}

async function verifyCandidate(
  candidate: QualityFeedbackCandidate,
  verifier: PaymentProofVerifier,
  identity: IdentitySnapshot,
): Promise<CandidateVerification> {
  const proof = candidate.feedback.proofOfPayment;

  if (proof === undefined) {
    return { candidate };
  }

  try {
    return {
      candidate,
      verification: await verifier.verify(proof, identity),
    };
  } catch (error) {
    return {
      candidate,
      verifierError:
        error instanceof Error ? error.message : "Payment verifier failed",
    };
  }
}

function proofMatchesVerification(
  candidate: QualityFeedbackCandidate,
  verification: Extract<PaymentProofVerification, { status: "VERIFIED" }>,
): boolean {
  const proof = candidate.feedback.proofOfPayment!;

  return (
    proof.chainId === verification.receipt.chainId &&
    sameHex(proof.txHash, verification.receipt.txHash) &&
    (proof.logIndex === undefined ||
      proof.logIndex === verification.receipt.logIndex) &&
    sameHex(proof.fromAddress, verification.payer) &&
    sameHex(proof.toAddress, verification.recipient) &&
    (proof.authorizationNonce === undefined ||
      (verification.authorizationNonce !== undefined &&
        sameHex(
          proof.authorizationNonce,
          verification.authorizationNonce,
        )))
  );
}

function distinctReviewerScores(
  accepted: readonly FeedbackEvaluation[],
): Map<string, number[]> {
  const scoresByReviewer = new Map<string, number[]>();

  for (const item of accepted) {
    const reviewer = item.clientAddress.toLowerCase();
    const scores = scoresByReviewer.get(reviewer) ?? [];
    scores.push(item.scoreBps!);
    scoresByReviewer.set(reviewer, scores);
  }

  return scoresByReviewer;
}

export async function assessB3Reputation(
  input: B3AssessmentInput,
): Promise<ReputationAssessment> {
  const reviewersForFullConfidence = input.reviewersForFullConfidence ?? 5;
  const filtered = filterQualityFeedback(input.feedback, input.scope);
  const verifiedCandidates = await Promise.all(
    sortCandidates(filtered.candidates).map((candidate) =>
      verifyCandidate(candidate, input.paymentProofVerifier, input.identity),
    ),
  );
  const acceptedFeedback: FeedbackEvaluation[] = [];
  const rejectedFeedback: FeedbackEvaluation[] = [...filtered.rejected];
  const usedReceiptKeys = new Set<string>();
  const usedAuthorizationKeys = new Set<string>();
  let invalidPaymentPresent = false;
  let replayAttemptPresent = false;
  let ungroundedFeedbackPresent = false;

  for (const item of verifiedCandidates) {
    const { candidate, verification, verifierError } = item;
    const proof = candidate.feedback.proofOfPayment;

    if (proof === undefined) {
      ungroundedFeedbackPresent = true;
      rejectedFeedback.push(
        rejectCandidate(candidate, "MISSING_PAYMENT_PROOF"),
      );
      continue;
    }

    if (verification === undefined || verification.status === "INVALID") {
      invalidPaymentPresent = true;
      rejectedFeedback.push(
        rejectCandidate(
          candidate,
          "INVALID_PAYMENT",
          verifierError ?? verification?.detail ?? verification?.code,
        ),
      );
      continue;
    }

    if (!proofMatchesVerification(candidate, verification)) {
      invalidPaymentPresent = true;
      rejectedFeedback.push(
        rejectCandidate(candidate, "PAYMENT_PROOF_MISMATCH"),
      );
      continue;
    }

    if (!sameHex(verification.payer, candidate.feedback.clientAddress)) {
      invalidPaymentPresent = true;
      rejectedFeedback.push(rejectCandidate(candidate, "PAYER_MISMATCH"));
      continue;
    }

    if (!sameHex(verification.recipient, input.identity.agentWallet)) {
      invalidPaymentPresent = true;
      rejectedFeedback.push(
        rejectCandidate(candidate, "RECIPIENT_MISMATCH"),
      );
      continue;
    }

    if (!sameHex(verification.identityEpoch, input.identity.identityEpoch)) {
      invalidPaymentPresent = true;
      rejectedFeedback.push(
        rejectCandidate(candidate, "IDENTITY_EPOCH_MISMATCH"),
      );
      continue;
    }

    if (verification.settledAtBlock > candidate.feedback.observedAtBlock) {
      invalidPaymentPresent = true;
      rejectedFeedback.push(
        rejectCandidate(candidate, "PAYMENT_AFTER_FEEDBACK"),
      );
      continue;
    }

    if (verification.amount <= 0n) {
      invalidPaymentPresent = true;
      rejectedFeedback.push(
        rejectCandidate(candidate, "INVALID_PAYMENT", "Payment amount is zero"),
      );
      continue;
    }

    const receiptKey = createReceiptKey(verification.receipt);
    const authorizationKey =
      verification.authorizationNonce === undefined
        ? undefined
        : createAuthorizationKey(
            verification.receipt.chainId,
            verification.authorizationNonce,
          );

    const existingReceiptClaim =
      input.receiptUsageReader === undefined
        ? null
        : await input.receiptUsageReader.findReceiptClaim(receiptKey);
    const existingAuthorizationClaim =
      authorizationKey === undefined || input.receiptUsageReader === undefined
        ? null
        : await input.receiptUsageReader.findAuthorizationClaim(
            authorizationKey,
          );

    if (
      usedReceiptKeys.has(receiptKey) ||
      (authorizationKey !== undefined &&
        usedAuthorizationKeys.has(authorizationKey)) ||
      (existingReceiptClaim !== null &&
        existingReceiptClaim.feedbackKey !== candidate.feedbackKey) ||
      (existingAuthorizationClaim !== null &&
        existingAuthorizationClaim.feedbackKey !== candidate.feedbackKey)
    ) {
      replayAttemptPresent = true;
      rejectedFeedback.push(
        rejectCandidate(candidate, "RECEIPT_REPLAY", undefined),
      );
      continue;
    }

    usedReceiptKeys.add(receiptKey);
    if (authorizationKey !== undefined) {
      usedAuthorizationKeys.add(authorizationKey);
    }

    acceptedFeedback.push({
      feedbackKey: candidate.feedbackKey,
      clientAddress: candidate.feedback.clientAddress,
      status: "ACCEPTED",
      scoreBps: candidate.scoreBps,
      receiptKey,
      ...(authorizationKey === undefined ? {} : { authorizationKey }),
    });
  }

  const scoresByReviewer = distinctReviewerScores(acceptedFeedback);
  const reviewerScores = [...scoresByReviewer.values()].map(
    (scores) => averageScoreBps(scores)!,
  );
  const distinctReviewerCount = scoresByReviewer.size;
  const riskFlags: ReputationRiskFlag[] = [];

  if (acceptedFeedback.length === 0) {
    riskFlags.push("NO_VERIFIED_FEEDBACK");
  }
  if (distinctReviewerCount < reviewersForFullConfidence) {
    riskFlags.push("LOW_DISTINCT_REVIEWER_COUNT");
  }
  if (invalidPaymentPresent) {
    riskFlags.push("INVALID_PAYMENT_PRESENT");
  }
  if (replayAttemptPresent) {
    riskFlags.push("REPLAY_ATTEMPT_PRESENT");
  }
  if (ungroundedFeedbackPresent) {
    riskFlags.push("UNGROUNDED_FEEDBACK_PRESENT");
  }

  return {
    model: "B3_REPUGATE",
    scoreBps: averageScoreBps(reviewerScores),
    confidenceBps: confidenceFromDistinctReviewers(
      distinctReviewerCount,
      reviewersForFullConfidence,
    ),
    distinctReviewerCount,
    acceptedFeedback,
    rejectedFeedback,
    riskFlags,
  };
}
