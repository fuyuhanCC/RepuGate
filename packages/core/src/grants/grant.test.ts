import { describe, expect, it } from "vitest";

import type { Address, Bytes32 } from "../domain/types";
import { createDeterministicScenario } from "../fixtures/scenarios";
import { evaluateOffer } from "../evaluation/evaluate-offer";
import {
  assertGrantConsumable,
  GrantError,
  issueEvaluationGrant,
} from "./grant";

const BUYER =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;

async function allowedEvaluation() {
  const scenario = createDeterministicScenario(
    "honest-service",
    "B3_REPUGATE",
  );
  return evaluateOffer(scenario.input, scenario.ports);
}

describe("evaluation grants", () => {
  it("issues a short-lived grant only for an ALLOW result", async () => {
    const evaluation = await allowedEvaluation();
    const grant = issueEvaluationGrant({
      id: "grant-1",
      decisionId: "decision-1",
      buyer: BUYER,
      evaluation,
      issuedAt: 1_000,
      lifetimeSeconds: 60,
    });

    expect(grant).toMatchObject({
      id: "grant-1",
      status: "ISSUED",
      issuedAt: 1_000,
      expiresAt: 1_060,
      offerHash: evaluation.offerHash,
      identityEpoch: evaluation.identity.identityEpoch,
      policyHash: evaluation.policyHash,
    });
  });

  it("rejects issuance for REVIEW or BLOCK", async () => {
    const evaluation = await allowedEvaluation();

    expect(() =>
      issueEvaluationGrant({
        id: "grant-1",
        decisionId: "decision-1",
        buyer: BUYER,
        evaluation: { ...evaluation, decision: "REVIEW" },
        issuedAt: 1_000,
        lifetimeSeconds: 60,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<GrantError>>({ code: "GRANT_NOT_ALLOWED" }),
    );
  });

  it.each([
    ["buyer", { buyer: "0xcccccccccccccccccccccccccccccccccccccccc" }, "GRANT_BUYER_MISMATCH"],
    ["offer", { offerHash: `0x${"11".repeat(32)}` }, "GRANT_OFFER_MISMATCH"],
    ["identity", { identityEpoch: `0x${"22".repeat(32)}` }, "GRANT_IDENTITY_MISMATCH"],
    ["policy", { policyHash: `0x${"33".repeat(32)}` }, "GRANT_POLICY_MISMATCH"],
  ] as const)("rejects a mismatched %s binding", async (_label, override, code) => {
    const evaluation = await allowedEvaluation();
    const grant = issueEvaluationGrant({
      id: "grant-1",
      decisionId: "decision-1",
      buyer: BUYER,
      evaluation,
      issuedAt: 1_000,
      lifetimeSeconds: 60,
    });

    expect(() =>
      assertGrantConsumable(
        grant,
        {
          buyer: grant.buyer,
          offerHash: grant.offerHash,
          identityEpoch: grant.identityEpoch,
          policyHash: grant.policyHash,
          ...override,
        } as {
          buyer: Address;
          offerHash: Bytes32;
          identityEpoch: Bytes32;
          policyHash: Bytes32;
        },
        1_030,
      ),
    ).toThrowError(expect.objectContaining<Partial<GrantError>>({ code }));
  });

  it("treats expiresAt as an exclusive boundary", async () => {
    const evaluation = await allowedEvaluation();
    const grant = issueEvaluationGrant({
      id: "grant-1",
      decisionId: "decision-1",
      buyer: BUYER,
      evaluation,
      issuedAt: 1_000,
      lifetimeSeconds: 60,
    });

    expect(() =>
      assertGrantConsumable(
        grant,
        {
          buyer: grant.buyer,
          offerHash: grant.offerHash,
          identityEpoch: grant.identityEpoch,
          policyHash: grant.policyHash,
        },
        1_060,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<GrantError>>({ code: "GRANT_EXPIRED" }),
    );

    expect(() =>
      assertGrantConsumable(
        { ...grant, status: "EXPIRED" },
        {
          buyer: grant.buyer,
          offerHash: grant.offerHash,
          identityEpoch: grant.identityEpoch,
          policyHash: grant.policyHash,
        },
        1_030,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<GrantError>>({ code: "GRANT_EXPIRED" }),
    );
  });
});
