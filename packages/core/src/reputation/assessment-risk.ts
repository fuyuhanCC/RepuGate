import type { ReputationRiskFlag } from "../domain/evaluation";
import type { GroundedFeedbackResult } from "./grounded-feedback";
import { DEFAULT_MINIMUM_DISTINCT_REVIEWERS } from "./fixed-point";

export function groundedRiskFlags(
  grounded: GroundedFeedbackResult,
  distinctReviewerCount: number,
): ReputationRiskFlag[] {
  const flags: ReputationRiskFlag[] = [];

  if (grounded.acceptedFeedback.length === 0) flags.push("NO_VERIFIED_FEEDBACK");
  if (distinctReviewerCount < DEFAULT_MINIMUM_DISTINCT_REVIEWERS) {
    flags.push("LOW_DISTINCT_REVIEWER_COUNT");
  }
  if (grounded.invalidPaymentPresent) flags.push("INVALID_PAYMENT_PRESENT");
  if (grounded.replayAttemptPresent) flags.push("REPLAY_ATTEMPT_PRESENT");
  if (grounded.ungroundedFeedbackPresent) {
    flags.push("UNGROUNDED_FEEDBACK_PRESENT");
  }

  return flags;
}
