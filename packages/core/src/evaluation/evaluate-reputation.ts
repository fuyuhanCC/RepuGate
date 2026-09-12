import type {
  PolicyConfig,
  ReputationEvaluationResult,
  ReputationModel,
} from "../domain/evaluation";
import type {
  PaymentProofVerifier,
  ReceiptUsageReader,
} from "../domain/evidence";
import type { FeedbackRecord } from "../domain/reputation";
import type { IdentitySnapshot } from "../domain/types";
import { evaluatePolicy } from "../policy/evaluate-policy";
import { assessB1RawReputation } from "../reputation/b1";
import { assessB3Reputation } from "../reputation/b3";
import type { QualityFeedbackScope } from "../reputation/quality-feedback";

interface CommonEvaluationInput {
  feedback: readonly FeedbackRecord[];
  identity: IdentitySnapshot;
  tag1?: string;
  tag2?: string;
  policy?: PolicyConfig;
  identityMatched?: boolean;
  offerRiskFlags?: readonly string[];
  reviewersForFullConfidence?: number;
  receiptUsageReader?: ReceiptUsageReader;
}

export interface B1ReputationEvaluationInput extends CommonEvaluationInput {
  model: "B1_RAW";
}

export interface B3ReputationEvaluationInput extends CommonEvaluationInput {
  model: "B3_REPUGATE";
  paymentProofVerifier: PaymentProofVerifier;
}

export type ReputationEvaluationInput =
  | B1ReputationEvaluationInput
  | B3ReputationEvaluationInput;

function buildScope(input: CommonEvaluationInput): QualityFeedbackScope {
  return {
    agent: input.identity.agent,
    endpoint: input.identity.registeredEndpoint,
    tag1: input.tag1 ?? "quality",
    ...(input.tag2 === undefined ? {} : { tag2: input.tag2 }),
  };
}

export async function evaluateReputation(
  input: ReputationEvaluationInput,
): Promise<ReputationEvaluationResult> {
  const scope = buildScope(input);
  const b1 = assessB1RawReputation({
    feedback: input.feedback,
    scope,
    reviewersForFullConfidence: input.reviewersForFullConfidence,
  });
  const assessment =
    input.model === "B1_RAW"
      ? b1
      : await assessB3Reputation({
          feedback: input.feedback,
          identity: input.identity,
          scope,
          paymentProofVerifier: input.paymentProofVerifier,
          receiptUsageReader: input.receiptUsageReader,
          reviewersForFullConfidence: input.reviewersForFullConfidence,
        });
  const policyDecision = evaluatePolicy({
    assessment,
    policy: input.policy,
    identityMatched: input.identityMatched,
    offerRiskFlags: input.offerRiskFlags,
  });

  return {
    model: assessment.model as ReputationModel,
    rawScoreBps: b1.scoreBps,
    verifiedScoreBps:
      assessment.model === "B3_REPUGATE" ? assessment.scoreBps : null,
    confidenceBps: assessment.confidenceBps,
    distinctReviewerCount: assessment.distinctReviewerCount,
    acceptedFeedback: assessment.acceptedFeedback,
    rejectedFeedback: assessment.rejectedFeedback,
    riskFlags: assessment.riskFlags,
    decision: policyDecision.decision,
    decisionReasons: policyDecision.reasons,
    policyHash: policyDecision.policyHash,
  };
}
