import { describe, expect, it } from "vitest";

import type { Bytes32 } from "../domain/types";
import { createDeterministicScenario } from "../fixtures/scenarios";
import { evaluateOffer } from "./evaluate-offer";

function bytes32(byte: string): Bytes32 {
  return `0x${byte.repeat(64)}` as Bytes32;
}

describe("evaluateOffer", () => {
  it("keeps shared offer and identity controls but does not read feedback for B0", async () => {
    const scenario = createDeterministicScenario(
      "honest-service",
      "B0_NO_GATE",
    );
    const result = await evaluateOffer(scenario.input, {
      ...scenario.ports,
      feedbackReader: {
        async listQualityFeedback() {
          throw new Error("B0 must not read reputation feedback");
        },
      },
      paymentProofVerifier: {
        async verify() {
          throw new Error("B0 must not verify payment evidence");
        },
      },
    });

    expect(result).toMatchObject({
      model: "B0_NO_GATE",
      rawScoreBps: null,
      verifiedScoreBps: null,
      confidenceBps: null,
      decision: "ALLOW",
      decisionReasons: ["REPUTATION_GATE_DISABLED"],
      identityMatched: true,
      offerRiskFlags: [],
    });
  });

  it("returns the canonical offer, recomputed identity, and reputation decision", async () => {
    const scenario = createDeterministicScenario(
      "honest-service",
      "B3_REPUGATE",
    );

    const result = await evaluateOffer(scenario.input, scenario.ports);

    expect(result).toMatchObject({
      model: "B3_REPUGATE",
      rawScoreBps: 9_000,
      verifiedScoreBps: 7_400,
      confidenceBps: 6_000,
      decision: "ALLOW",
      identityMatched: true,
      offerRiskFlags: [],
      evaluatedAt: 1_700_000_000,
    });
    expect(result.canonicalOffer.amount).toBe(10_000n);
    expect(result.canonicalOffer.payTo).toBe(result.identity.agentWallet);
  });

  it("does not consume payment evidence when the read-only evaluation repeats", async () => {
    const scenario = createDeterministicScenario(
      "honest-service",
      "B3_REPUGATE",
    );

    const first = await evaluateOffer(scenario.input, scenario.ports);
    const second = await evaluateOffer(scenario.input, scenario.ports);

    expect(second).toEqual(first);
    expect(second.acceptedFeedback).toHaveLength(3);
  });

  it("blocks an identity reader that returns a stale or forged epoch", async () => {
    const scenario = createDeterministicScenario(
      "honest-service",
      "B1_RAW",
    );
    const genuineReader = scenario.ports.identityReader;
    const result = await evaluateOffer(scenario.input, {
      ...scenario.ports,
      identityReader: {
        async resolve(reference) {
          const identity = await genuineReader.resolve(reference);
          return { ...identity, identityEpoch: bytes32("e") };
        },
      },
    });

    expect(result.identityMatched).toBe(false);
    expect(result.decision).toBe("BLOCK");
    expect(result.decisionReasons).toContain("IDENTITY_EPOCH_MISMATCH");
    expect(result.identity.identityEpoch).not.toBe(bytes32("e"));
  });

  it.each([
    [
      "payTo",
      { payTo: "0x9999999999999999999999999999999999999999" },
      "PAY_TO_MISMATCH",
    ],
    [
      "endpoint hash",
      { endpointHash: bytes32("a") },
      "ENDPOINT_HASH_MISMATCH",
    ],
    [
      "resource URL",
      { resourceUrl: "https://provider.example/services/honest-impersonator" },
      "RESOURCE_ENDPOINT_MISMATCH",
    ],
  ])("blocks a mismatched %s", async (_label, override, expectedFlag) => {
    const scenario = createDeterministicScenario(
      "honest-service",
      "B1_RAW",
    );
    const result = await evaluateOffer(
      {
        ...scenario.input,
        offer: { ...scenario.input.offer, ...override },
      },
      scenario.ports,
    );

    expect(result.decision).toBe("BLOCK");
    expect(result.offerRiskFlags).toContain(expectedFlag);
  });
});
