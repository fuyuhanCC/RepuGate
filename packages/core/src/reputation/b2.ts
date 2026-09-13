import type {
  ReputationAssessment,
  ReputationRiskFlag,
} from "../domain/evaluation";
import type {
  PaymentProofVerifier,
  ReceiptUsageReader,
} from "../domain/evidence";
import type { FeedbackRecord } from "../domain/reputation";
import type { IdentitySnapshot } from "../domain/types";
import {
  averageScoreBps,
  confidenceFromDistinctReviewers,
} from "./fixed-point";
import { verifyGroundedFeedback } from "./grounded-feedback";
import type { QualityFeedbackScope } from "./quality-feedback";

export interface B2AssessmentInput {
  feedback: readonly FeedbackRecord[];
  identity: IdentitySnapshot;
  scope: QualityFeedbackScope;
  paymentProofVerifier: PaymentProofVerifier;
  receiptUsageReader?: ReceiptUsageReader;
  reviewersForFullConfidence?: number;
}

export async function assessB2GroundedReputation(
  input: B2AssessmentInput,
): Promise<ReputationAssessment> {
  const reviewersForFullConfidence = input.reviewersForFullConfidence ?? 5;
  const grounded = await verifyGroundedFeedback(input);
  const distinctReviewerCount = new Set(
    grounded.acceptedFeedback.map((item) => item.clientAddress.toLowerCase()),
  ).size;
  const riskFlags: ReputationRiskFlag[] = [];

  if (grounded.acceptedFeedback.length === 0) {
    riskFlags.push("NO_VERIFIED_FEEDBACK");
  }
  if (distinctReviewerCount < reviewersForFullConfidence) {
    riskFlags.push("LOW_DISTINCT_REVIEWER_COUNT");
  }
  if (grounded.invalidPaymentPresent) {
    riskFlags.push("INVALID_PAYMENT_PRESENT");
  }
  if (grounded.replayAttemptPresent) {
    riskFlags.push("REPLAY_ATTEMPT_PRESENT");
  }
  if (grounded.ungroundedFeedbackPresent) {
    riskFlags.push("UNGROUNDED_FEEDBACK_PRESENT");
  }

  return {
    model: "B2_GROUNDED",
    scoreBps: averageScoreBps(
      grounded.acceptedFeedback.map((item) => item.scoreBps!),
    ),
    confidenceBps: confidenceFromDistinctReviewers(
      distinctReviewerCount,
      reviewersForFullConfidence,
    ),
    distinctReviewerCount,
    acceptedFeedback: grounded.acceptedFeedback,
    rejectedFeedback: grounded.rejectedFeedback,
    riskFlags,
  };
}
