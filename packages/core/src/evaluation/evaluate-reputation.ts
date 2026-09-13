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
import { assessB0NoGate } from "../reputation/b0";
import { assessB1RawReputation } from "../reputation/b1";
import { assessB2GroundedReputation } from "../reputation/b2";
import { assessB3Reputation } from "../reputation/b3";
import { assessB3DirichletReputation } from "../reputation/b3-dirichlet";
import type { QualityFeedbackScope } from "../reputation/quality-feedback";

interface PolicyEvaluationInput {
  policy?: PolicyConfig;
  identityMatched?: boolean;
  offerRiskFlags?: readonly string[];
}

interface CommonEvaluationInput extends PolicyEvaluationInput {
  feedback: readonly FeedbackRecord[];
  identity: IdentitySnapshot;
  tag1?: string;
  tag2?: string;
  receiptUsageReader?: ReceiptUsageReader;
}

export interface B0ReputationEvaluationInput extends PolicyEvaluationInput {
  model: "B0_NO_GATE";
}

export interface B1ReputationEvaluationInput extends CommonEvaluationInput {
  model: "B1_RAW";
}

interface GroundedReputationEvaluationInput extends CommonEvaluationInput {
  paymentProofVerifier: PaymentProofVerifier;
}

export interface B2ReputationEvaluationInput
  extends GroundedReputationEvaluationInput {
  model: "B2_GROUNDED";
}

export interface B3ReputationEvaluationInput
  extends GroundedReputationEvaluationInput {
  model: "B3_REPUGATE";
}

export interface B3DirichletReputationEvaluationInput
  extends GroundedReputationEvaluationInput {
  model: "B3_DIRICHLET";
}

export type ReputationEvaluationInput =
  | B0ReputationEvaluationInput
  | B1ReputationEvaluationInput
  | B2ReputationEvaluationInput
  | B3ReputationEvaluationInput
  | B3DirichletReputationEvaluationInput;

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
  if (input.model === "B0_NO_GATE") {
    const assessment = assessB0NoGate();
    const policyDecision = evaluatePolicy({
      assessment,
      policy: input.policy,
      identityMatched: input.identityMatched,
      offerRiskFlags: input.offerRiskFlags,
    });

    return {
      model: assessment.model,
      rawScoreBps: null,
      verifiedScoreBps: null,
      confidenceBps: null,
      distinctReviewerCount: 0,
      acceptedFeedback: [],
      rejectedFeedback: [],
      riskFlags: [],
      decision: policyDecision.decision,
      decisionReasons: policyDecision.reasons,
      policyHash: policyDecision.policyHash,
    };
  }

  const scope = buildScope(input);
  const b1 = assessB1RawReputation({
    feedback: input.feedback,
    scope,
  });
  let assessment;

  switch (input.model) {
    case "B1_RAW":
      assessment = b1;
      break;
    case "B2_GROUNDED":
      assessment = await assessB2GroundedReputation({
        feedback: input.feedback,
        identity: input.identity,
        scope,
        paymentProofVerifier: input.paymentProofVerifier,
        receiptUsageReader: input.receiptUsageReader,
      });
      break;
    case "B3_REPUGATE":
      assessment = await assessB3Reputation({
        feedback: input.feedback,
        identity: input.identity,
        scope,
        paymentProofVerifier: input.paymentProofVerifier,
        receiptUsageReader: input.receiptUsageReader,
      });
      break;
    case "B3_DIRICHLET":
      assessment = await assessB3DirichletReputation({
        feedback: input.feedback,
        identity: input.identity,
        scope,
        paymentProofVerifier: input.paymentProofVerifier,
        receiptUsageReader: input.receiptUsageReader,
      });
      break;
  }
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
      assessment.model === "B1_RAW" ? null : assessment.scoreBps,
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
