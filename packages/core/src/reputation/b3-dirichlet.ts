import type { ReputationAssessment } from "../domain/evaluation";
import type {
  PaymentProofVerifier,
  ReceiptUsageReader,
} from "../domain/evidence";
import type { FeedbackRecord } from "../domain/reputation";
import type { IdentitySnapshot } from "../domain/types";
import { groundedRiskFlags } from "./assessment-risk";
import { dirichletGoodOrBetterBps } from "./bayesian-score";
import { confidenceFromDistinctReviewers } from "./fixed-point";
import { verifyGroundedFeedback } from "./grounded-feedback";
import type { QualityFeedbackScope } from "./quality-feedback";
import { reviewerMeanScoresBps } from "./reviewer-evidence";

export interface B3DirichletAssessmentInput {
  feedback: readonly FeedbackRecord[];
  identity: IdentitySnapshot;
  scope: QualityFeedbackScope;
  paymentProofVerifier: PaymentProofVerifier;
  receiptUsageReader?: ReceiptUsageReader;
}

export async function assessB3DirichletReputation(
  input: B3DirichletAssessmentInput,
): Promise<ReputationAssessment> {
  const grounded = await verifyGroundedFeedback(input);
  const reviewerScores = reviewerMeanScoresBps(grounded.acceptedFeedback);
  const distinctReviewerCount = reviewerScores.length;

  return {
    model: "B3_DIRICHLET",
    scoreBps: dirichletGoodOrBetterBps(reviewerScores),
    confidenceBps: confidenceFromDistinctReviewers(distinctReviewerCount),
    distinctReviewerCount,
    acceptedFeedback: grounded.acceptedFeedback,
    rejectedFeedback: grounded.rejectedFeedback,
    riskFlags: groundedRiskFlags(grounded, distinctReviewerCount),
  };
}
