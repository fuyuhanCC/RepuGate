import type {
  FeedbackEvaluation,
  FeedbackRejectionReason,
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
  filterQualityFeedback,
  type QualityFeedbackCandidate,
  type QualityFeedbackScope,
} from "./quality-feedback";

export interface GroundedFeedbackInput {
  feedback: readonly FeedbackRecord[];
  identity: IdentitySnapshot;
  scope: QualityFeedbackScope;
  paymentProofVerifier: PaymentProofVerifier;
  receiptUsageReader?: ReceiptUsageReader;
}

export interface GroundedFeedbackResult {
  acceptedFeedback: FeedbackEvaluation[];
  rejectedFeedback: FeedbackEvaluation[];
  invalidPaymentPresent: boolean;
  replayAttemptPresent: boolean;
  ungroundedFeedbackPresent: boolean;
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
        sameHex(proof.authorizationNonce, verification.authorizationNonce)))
  );
}

export async function verifyGroundedFeedback(
  input: GroundedFeedbackInput,
): Promise<GroundedFeedbackResult> {
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
      rejectedFeedback.push(rejectCandidate(candidate, "RECEIPT_REPLAY"));
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

  return {
    acceptedFeedback,
    rejectedFeedback,
    invalidPaymentPresent,
    replayAttemptPresent,
    ungroundedFeedbackPresent,
  };
}
