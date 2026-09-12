import { describe, expect, it } from "vitest";

import type { ReputationAssessment } from "../domain/evaluation";
import { evaluatePolicy, hashPolicy } from "./evaluate-policy";

function assessment(
  scoreBps: number | null,
  confidenceBps: number,
): ReputationAssessment {
  return {
    model: "B3_REPUGATE",
    scoreBps,
    confidenceBps,
    distinctReviewerCount: 3,
    acceptedFeedback: [],
    rejectedFeedback: [],
    riskFlags: [],
  };
}

describe("policy evaluation", () => {
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
