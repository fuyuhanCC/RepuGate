import { describe, expect, it } from "vitest";

import { assessB0NoGate } from "./b0";

describe("B0 no-gate baseline", () => {
  it("makes no score, confidence, or feedback claim", () => {
    expect(assessB0NoGate()).toEqual({
      model: "B0_NO_GATE",
      scoreBps: null,
      confidenceBps: null,
      distinctReviewerCount: 0,
      acceptedFeedback: [],
      rejectedFeedback: [],
      riskFlags: [],
    });
  });
});
