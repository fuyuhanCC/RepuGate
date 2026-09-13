import { describe, expect, it } from "vitest";

import type {
  ReputationAssessment,
  ReputationModel,
} from "../domain/evaluation";
import { evaluatePolicy, hashPolicy } from "./evaluate-policy";

function assessment(
  scoreBps: number | null,
  confidenceBps: number | null,
  model: ReputationModel = "B3_REPUGATE",
): ReputationAssessment {
  return {
    model,
    scoreBps,
    confidenceBps,
    distinctReviewerCount: 3,
    acceptedFeedback: [],
    rejectedFeedback: [],
    riskFlags: [],
  };
}

describe("policy evaluation", () => {
  it("allows B0 without a reputation score after shared binding checks pass", () => {
    expect(
      evaluatePolicy({
        assessment: assessment(null, null, "B0_NO_GATE"),
      }),
    ).toMatchObject({
      decision: "ALLOW",
      reasons: ["REPUTATION_GATE_DISABLED"],
    });
  });

  it("uses inclusive ALLOW boundaries", () => {
    expect(
      evaluatePolicy({ assessment: assessment(7_000, 6_000) }).decision,
    ).toBe("ALLOW");
  });

  it("reviews an adequate score with insufficient confidence", () => {
    const result = evaluatePolicy({ assessment: assessment(7_000, 5_999) });

    expect(result.decision).toBe("REVIEW");
    expect(result.reasons).toEqual(["CONFIDENCE_BELOW_ALLOW_THRESHOLD"]);
  });

  it("uses confidence as a hard gate only in the B3 family", () => {
    expect(
      evaluatePolicy({
        assessment: assessment(10_000, 2_000, "B2_GROUNDED"),
      }),
    ).toMatchObject({
      decision: "ALLOW",
      reasons: ["SCORE_MEETS_ALLOW_POLICY"],
    });
    expect(
      evaluatePolicy({
        assessment: assessment(10_000, 2_000, "B3_REPUGATE"),
      }),
    ).toMatchObject({
      decision: "REVIEW",
      reasons: ["CONFIDENCE_BELOW_ALLOW_THRESHOLD"],
    });
    expect(
      evaluatePolicy({
        assessment: assessment(10_000, 2_000, "B3_DIRICHLET"),
      }),
    ).toMatchObject({
      decision: "REVIEW",
      reasons: ["CONFIDENCE_BELOW_ALLOW_THRESHOLD"],
    });
  });

  it("blocks a low score or an absent score", () => {
    expect(
      evaluatePolicy({ assessment: assessment(4_999, 10_000) }).decision,
    ).toBe("BLOCK");
    expect(
      evaluatePolicy({ assessment: assessment(null, 0) }).decision,
    ).toBe("BLOCK");
  });

  it("blocks identity and offer binding failures before score evaluation", () => {
    expect(
      evaluatePolicy({
        assessment: assessment(10_000, 10_000),
        identityMatched: false,
      }).reasons,
    ).toEqual(["IDENTITY_EPOCH_MISMATCH"]);

    expect(
      evaluatePolicy({
        assessment: assessment(10_000, 10_000),
        offerRiskFlags: ["PAY_TO_MISMATCH", "AMOUNT_MISMATCH"],
      }).reasons,
    ).toEqual([
      "OFFER_RISK:AMOUNT_MISMATCH",
      "OFFER_RISK:PAY_TO_MISMATCH",
    ]);

    expect(
      evaluatePolicy({
        assessment: assessment(null, null, "B0_NO_GATE"),
        offerRiskFlags: ["OFFER_HASH_MISMATCH"],
      }).decision,
    ).toBe("BLOCK");
  });

  it("hashes equivalent policy values deterministically", () => {
    const policy = {
      version: "course-demo-v1",
      allowScoreBps: 7_000,
      allowConfidenceBps: 6_000,
      reviewScoreBps: 5_000,
    };

    expect(hashPolicy(policy)).toBe(hashPolicy({ ...policy }));
  });
});
