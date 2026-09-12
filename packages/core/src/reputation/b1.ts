import type {
  FeedbackEvaluation,
  ReputationAssessment,
  ReputationRiskFlag,
} from "../domain/evaluation";
import type { FeedbackRecord } from "../domain/reputation";
import {
  averageScoreBps,
  confidenceFromDistinctReviewers,
} from "./fixed-point";
import {
  filterQualityFeedback,
  type QualityFeedbackScope,
} from "./quality-feedback";

export interface B1AssessmentInput {
  feedback: readonly FeedbackRecord[];
  scope: QualityFeedbackScope;
  reviewersForFullConfidence?: number;
}

export function assessB1RawReputation(
  input: B1AssessmentInput,
): ReputationAssessment {
  const reviewersForFullConfidence = input.reviewersForFullConfidence ?? 5;
  const filtered = filterQualityFeedback(input.feedback, input.scope);
  const acceptedFeedback: FeedbackEvaluation[] = filtered.candidates.map(
    (candidate) => ({
      feedbackKey: candidate.feedbackKey,
      clientAddress: candidate.feedback.clientAddress,
      status: "ACCEPTED",
      scoreBps: candidate.scoreBps,
    }),
  );
  const distinctReviewerCount = new Set(
    filtered.candidates.map((candidate) =>
      candidate.feedback.clientAddress.toLowerCase(),
    ),
  ).size;
  const riskFlags: ReputationRiskFlag[] = [];

  if (acceptedFeedback.length === 0) {
    riskFlags.push("NO_ELIGIBLE_FEEDBACK");
  }

  if (distinctReviewerCount < reviewersForFullConfidence) {
    riskFlags.push("LOW_DISTINCT_REVIEWER_COUNT");
  }

  return {
    model: "B1_RAW",
    scoreBps: averageScoreBps(
      acceptedFeedback.map((item) => item.scoreBps!),
    ),
    confidenceBps: confidenceFromDistinctReviewers(
      distinctReviewerCount,
      reviewersForFullConfidence,
    ),
    distinctReviewerCount,
    acceptedFeedback,
    rejectedFeedback: filtered.rejected,
    riskFlags,
  };
}
