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
  it("shows why raw B1 can allow an ungrounded reputation attack that B3 blocks", async () => {
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
    const b3 = await evaluateReputation({
      model: "B3_REPUGATE",
      feedback,
      identity: IDENTITY,
      tag2: "inference",
      paymentProofVerifier: new MapPaymentProofVerifier(new Map()),
    });

    expect(b1).toMatchObject({
      rawScoreBps: 10_000,
      verifiedScoreBps: null,
      confidenceBps: 10_000,
      decision: "ALLOW",
    });
    expect(b3).toMatchObject({
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
      verifiedScoreBps: 9_000,
      confidenceBps: 6_000,
      distinctReviewerCount: 3,
      decision: "ALLOW",
    });
  });
});
