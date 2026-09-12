import { encodeAbiParameters, keccak256 } from "viem";

import type {
  PolicyConfig,
  PolicyDecision,
  ReputationAssessment,
} from "../domain/evaluation";
import type { Bytes32 } from "../domain/types";
import { MAX_SCORE_BPS } from "../reputation/fixed-point";

const POLICY_ABI = [
  { name: "version", type: "string" },
  { name: "allowScoreBps", type: "uint16" },
  { name: "allowConfidenceBps", type: "uint16" },
  { name: "reviewScoreBps", type: "uint16" },
] as const;

export const DEFAULT_POLICY_CONFIG: Readonly<PolicyConfig> = Object.freeze({
  version: "repugate-policy-v1",
  allowScoreBps: 7_000,
  allowConfidenceBps: 6_000,
  reviewScoreBps: 5_000,
});

export interface EvaluatePolicyInput {
  assessment: ReputationAssessment;
  policy?: PolicyConfig;
  identityMatched?: boolean;
  offerRiskFlags?: readonly string[];
}

function assertBps(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SCORE_BPS) {
    throw new RangeError(`${name} must be an integer between 0 and 10000`);
  }
}

function validatePolicy(policy: PolicyConfig): void {
  if (policy.version.trim() === "") {
    throw new TypeError("policy version must not be empty");
  }

  assertBps("allowScoreBps", policy.allowScoreBps);
  assertBps("allowConfidenceBps", policy.allowConfidenceBps);
  assertBps("reviewScoreBps", policy.reviewScoreBps);

  if (policy.reviewScoreBps > policy.allowScoreBps) {
    throw new RangeError("reviewScoreBps must not exceed allowScoreBps");
  }
}

export function hashPolicy(policy: PolicyConfig): Bytes32 {
  validatePolicy(policy);

  return keccak256(
    encodeAbiParameters(POLICY_ABI, [
      policy.version,
      policy.allowScoreBps,
      policy.allowConfidenceBps,
      policy.reviewScoreBps,
    ]),
  );
}

export function evaluatePolicy(input: EvaluatePolicyInput): PolicyDecision {
  const policy = input.policy ?? DEFAULT_POLICY_CONFIG;
  const policyHash = hashPolicy(policy);
  const offerRiskFlags = [...(input.offerRiskFlags ?? [])].sort();

  if (input.identityMatched === false) {
    return {
      decision: "BLOCK",
      reasons: [
        "IDENTITY_EPOCH_MISMATCH",
        ...offerRiskFlags.map((flag) => `OFFER_RISK:${flag}`),
      ],
      policyHash,
    };
  }

  if (offerRiskFlags.length > 0) {
    return {
      decision: "BLOCK",
      reasons: offerRiskFlags.map((flag) => `OFFER_RISK:${flag}`),
      policyHash,
    };
  }

  const { scoreBps, confidenceBps } = input.assessment;

  if (scoreBps === null) {
    return {
      decision: "BLOCK",
      reasons: ["NO_REPUTATION_SCORE"],
      policyHash,
    };
  }

  if (
    scoreBps >= policy.allowScoreBps &&
    confidenceBps >= policy.allowConfidenceBps
  ) {
    return {
      decision: "ALLOW",
      reasons: ["SCORE_AND_CONFIDENCE_MEET_ALLOW_POLICY"],
      policyHash,
    };
  }

  if (scoreBps >= policy.reviewScoreBps) {
    return {
      decision: "REVIEW",
      reasons: [
        scoreBps < policy.allowScoreBps
          ? "SCORE_BELOW_ALLOW_THRESHOLD"
          : "CONFIDENCE_BELOW_ALLOW_THRESHOLD",
      ],
      policyHash,
    };
  }

  return {
    decision: "BLOCK",
    reasons: ["SCORE_BELOW_REVIEW_THRESHOLD"],
    policyHash,
  };
}
