import { describe, expect, it } from "vitest";

import { evaluateOffer } from "../evaluation/evaluate-offer";
import { createDeterministicScenario } from "./scenarios";

async function run(
  id: Parameters<typeof createDeterministicScenario>[0],
  model: Parameters<typeof createDeterministicScenario>[1],
) {
  const scenario = createDeterministicScenario(id, model);
  return evaluateOffer(scenario.input, scenario.ports);
}

describe("deterministic presentation scenarios", () => {
  it("allows honest payment-grounded feedback under all three models", async () => {
    const [b1, b2, b3] = await Promise.all([
      run("honest-service", "B1_RAW"),
      run("honest-service", "B2_GROUNDED"),
      run("honest-service", "B3_REPUGATE"),
    ]);

    expect(b1).toMatchObject({ rawScoreBps: 9_000, decision: "ALLOW" });
    expect(b2).toMatchObject({
      verifiedScoreBps: 9_000,
      decision: "ALLOW",
    });
    expect(b3).toMatchObject({
      verifiedScoreBps: 9_000,
      decision: "ALLOW",
    });
  });

  it("shows B1 allowing high ungrounded feedback while B2 and B3 block it", async () => {
    const [b1, b2, b3] = await Promise.all([
      run("ungrounded-feedback", "B1_RAW"),
      run("ungrounded-feedback", "B2_GROUNDED"),
      run("ungrounded-feedback", "B3_REPUGATE"),
    ]);

    expect(b1).toMatchObject({
      rawScoreBps: 10_000,
      confidenceBps: 10_000,
      decision: "ALLOW",
    });
    expect(b3).toMatchObject({
      rawScoreBps: 10_000,
      verifiedScoreBps: null,
      decision: "BLOCK",
    });
    expect(b3.riskFlags).toContain("UNGROUNDED_FEEDBACK_PRESENT");
    expect(b2).toMatchObject({
      rawScoreBps: 10_000,
      verifiedScoreBps: null,
      decision: "BLOCK",
    });
  });

  it("shows B3 blocking paid feedback concentrated in one reviewer", async () => {
    const [b2, b3] = await Promise.all([
      run("reviewer-concentration", "B2_GROUNDED"),
      run("reviewer-concentration", "B3_REPUGATE"),
    ]);

    expect(b2).toMatchObject({
      verifiedScoreBps: 7_143,
      confidenceBps: 6_000,
      decision: "ALLOW",
    });
    expect(b3).toMatchObject({
      verifiedScoreBps: 3_333,
      confidenceBps: 6_000,
      decision: "BLOCK",
    });
    expect(b3.acceptedFeedback).toHaveLength(7);
  });

  it("counts replayed feedback in B1 but only one receipt in B3", async () => {
    const [b1, b3] = await Promise.all([
      run("receipt-replay", "B1_RAW"),
      run("receipt-replay", "B3_REPUGATE"),
    ]);

    expect(b1.rawScoreBps).toBe(8_200);
    expect(b1.acceptedFeedback).toHaveLength(5);
    expect(b3.verifiedScoreBps).toBe(1_000);
    expect(b3.acceptedFeedback).toHaveLength(1);
    expect(
      b3.rejectedFeedback.filter((item) => item.reason === "RECEIPT_REPLAY"),
    ).toHaveLength(4);
    expect(b3.decision).toBe("BLOCK");
  });

  it("blocks a changed amount even when the provider has good reputation", async () => {
    const result = await run("offer-substitution", "B3_REPUGATE");

    expect(result.verifiedScoreBps).toBe(9_000);
    expect(result.offerRiskFlags).toEqual(["OFFER_HASH_MISMATCH"]);
    expect(result.decision).toBe("BLOCK");
    expect(result.decisionReasons).toContain(
      "OFFER_RISK:OFFER_HASH_MISMATCH",
    );
  });
});
