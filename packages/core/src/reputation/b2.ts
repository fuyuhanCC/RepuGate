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
  DEFAULT_MINIMUM_DISTINCT_REVIEWERS,
} from "./fixed-point";
import { verifyGroundedFeedback } from "./grounded-feedback";
import type { QualityFeedbackScope } from "./quality-feedback";

export interface B2AssessmentInput {
  feedback: readonly FeedbackRecord[];
  identity: IdentitySnapshot;
  scope: QualityFeedbackScope;
  paymentProofVerifier: PaymentProofVerifier;
  receiptUsageReader?: ReceiptUsageReader;
}

export async function assessB2GroundedReputation(
  input: B2AssessmentInput,
): Promise<ReputationAssessment> {
  const grounded = await verifyGroundedFeedback(input);
  const distinctReviewerCount = new Set(
    grounded.acceptedFeedback.map((item) => item.clientAddress.toLowerCase()),
  ).size;
  const riskFlags: ReputationRiskFlag[] = [];

  if (grounded.acceptedFeedback.length === 0) {
    riskFlags.push("NO_VERIFIED_FEEDBACK");
  }
  if (distinctReviewerCount < DEFAULT_MINIMUM_DISTINCT_REVIEWERS) {
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
    confidenceBps: confidenceFromDistinctReviewers(distinctReviewerCount),
    distinctReviewerCount,
    acceptedFeedback: grounded.acceptedFeedback,
    rejectedFeedback: grounded.rejectedFeedback,
    riskFlags,
  };
}
