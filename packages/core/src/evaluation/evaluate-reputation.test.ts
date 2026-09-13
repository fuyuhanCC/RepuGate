import { describe, expect, it } from "vitest";

import type { FeedbackRecord } from "../domain/reputation";
import {
  bytes32,
  IDENTITY,
  makeFeedback,
  makePaymentProof,
  MapPaymentProofVerifier,
  REVIEWERS,
  verifiedEvidence,
} from "../testing/fixtures";
import { evaluateReputation } from "./evaluate-reputation";

describe("unified reputation evaluation", () => {
  it("returns an explicit no-reputation B0 decision", async () => {
    const result = await evaluateReputation({ model: "B0_NO_GATE" });

    expect(result).toEqual(
      expect.objectContaining({
        model: "B0_NO_GATE",
        rawScoreBps: null,
        verifiedScoreBps: null,
        confidenceBps: null,
        distinctReviewerCount: 0,
        acceptedFeedback: [],
        rejectedFeedback: [],
        riskFlags: [],
        decision: "ALLOW",
        decisionReasons: ["REPUTATION_GATE_DISABLED"],
      }),
    );
  });

  it("shows why raw B1 can allow an attack that both grounded models block", async () => {
    const feedback = REVIEWERS.map((clientAddress, index) =>
      makeFeedback({
        clientAddress,
        feedbackIndex: BigInt(index + 1),
        value: 100n,
      }),
    );

    const b1 = await evaluateReputation({
      model: "B1_RAW",
      feedback,
      identity: IDENTITY,
      tag2: "inference",
    });
    const b2 = await evaluateReputation({
      model: "B2_GROUNDED",
      feedback,
      identity: IDENTITY,
      tag2: "inference",
      paymentProofVerifier: new MapPaymentProofVerifier(new Map()),
    });
    const b3 = await evaluateReputation({
      model: "B3_REPUGATE",
      feedback,
      identity: IDENTITY,
      tag2: "inference",
      paymentProofVerifier: new MapPaymentProofVerifier(new Map()),
    });
    const dirichlet = await evaluateReputation({
      model: "B3_DIRICHLET",
      feedback,
      identity: IDENTITY,
      tag2: "inference",
      paymentProofVerifier: new MapPaymentProofVerifier(new Map()),
    });

    expect(b1).toMatchObject({
      rawScoreBps: 10_000,
      verifiedScoreBps: null,
      confidenceBps: 7_142,
      decision: "ALLOW",
    });
    expect(b3).toMatchObject({
      rawScoreBps: 10_000,
      verifiedScoreBps: null,
      confidenceBps: 0,
      decision: "BLOCK",
    });
    expect(b2).toMatchObject({
      rawScoreBps: 10_000,
      verifiedScoreBps: null,
      confidenceBps: 0,
      decision: "BLOCK",
    });
    expect(dirichlet).toMatchObject({
      rawScoreBps: 10_000,
      verifiedScoreBps: null,
      confidenceBps: 0,
      decision: "BLOCK",
    });
  });

  it("allows three honest reviewers with verified payments", async () => {
    const feedback: FeedbackRecord[] = [];
    const verifications = new Map();

    for (const [index, score] of [80, 90, 100].entries()) {
      const proof = makePaymentProof({
        clientAddress: REVIEWERS[index],
        txHash: bytes32(String(index + 1)),
        logIndex: index,
      });
      feedback.push(
        makeFeedback({
          clientAddress: REVIEWERS[index],
          feedbackIndex: BigInt(index + 1),
          value: BigInt(score),
          proofOfPayment: proof,
        }),
      );
      verifications.set(proof.txHash.toLowerCase(), verifiedEvidence(proof));
    }

    const result = await evaluateReputation({
      model: "B3_REPUGATE",
      feedback,
      identity: IDENTITY,
      tag2: "inference",
      paymentProofVerifier: new MapPaymentProofVerifier(verifications),
    });

    expect(result).toMatchObject({
      rawScoreBps: 9_000,
      verifiedScoreBps: 7_400,
      confidenceBps: 6_000,
      distinctReviewerCount: 3,
      decision: "ALLOW",
    });
  });

  it("allows the honest fixture under the Dirichlet good-or-better model", async () => {
    const feedback: FeedbackRecord[] = [];
    const verifications = new Map();

    for (const [index, score] of [80, 90, 100].entries()) {
      const proof = makePaymentProof({
        clientAddress: REVIEWERS[index],
        txHash: bytes32(String(index + 1)),
        logIndex: index,
      });
      feedback.push(
        makeFeedback({
          clientAddress: REVIEWERS[index],
          feedbackIndex: BigInt(index + 1),
          value: BigInt(score),
          proofOfPayment: proof,
        }),
      );
      verifications.set(proof.txHash.toLowerCase(), verifiedEvidence(proof));
    }

    const result = await evaluateReputation({
      model: "B3_DIRICHLET",
      feedback,
      identity: IDENTITY,
      tag2: "inference",
      paymentProofVerifier: new MapPaymentProofVerifier(verifications),
    });

    expect(result).toMatchObject({
      model: "B3_DIRICHLET",
      verifiedScoreBps: 7_600,
      confidenceBps: 6_000,
      distinctReviewerCount: 3,
      decision: "ALLOW",
    });
  });
});
