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
import { assessB2GroundedReputation } from "./b2";

const scope = {
  agent: IDENTITY.agent,
  endpoint: IDENTITY.registeredEndpoint,
  tag1: "quality",
  tag2: "inference",
};

describe("B2 payment-grounded reputation", () => {
  it("rejects ratings without payment evidence", async () => {
    const feedback = REVIEWERS.map((clientAddress, index) =>
      makeFeedback({
        clientAddress,
        feedbackIndex: BigInt(index + 1),
        value: 100n,
      }),
    );

    const result = await assessB2GroundedReputation({
      feedback,
      identity: IDENTITY,
      scope,
      paymentProofVerifier: new MapPaymentProofVerifier(new Map()),
    });

    expect(result).toMatchObject({
      model: "B2_GROUNDED",
      scoreBps: null,
      confidenceBps: 0,
      distinctReviewerCount: 0,
    });
    expect(result.riskFlags).toContain("UNGROUNDED_FEEDBACK_PRESENT");
  });

  it("averages unique paid records without B3 reviewer-level capping", async () => {
    const feedback: FeedbackRecord[] = [];
    const verifications = new Map();

    for (const [index, score] of [100, 100, 70].entries()) {
      const proof = makePaymentProof({
        clientAddress: REVIEWERS[0],
        txHash: bytes32(String(index + 1)),
        logIndex: index,
      });
      feedback.push(
        makeFeedback({
          clientAddress: REVIEWERS[0],
          feedbackIndex: BigInt(index + 1),
          value: BigInt(score),
          proofOfPayment: proof,
        }),
      );
      verifications.set(proof.txHash.toLowerCase(), verifiedEvidence(proof));
    }

    const result = await assessB2GroundedReputation({
      feedback,
      identity: IDENTITY,
      scope,
      paymentProofVerifier: new MapPaymentProofVerifier(verifications),
    });

    expect(result.scoreBps).toBe(9_000);
    expect(result.acceptedFeedback).toHaveLength(3);
    expect(result.distinctReviewerCount).toBe(1);
    expect(result.riskFlags).toContain("LOW_DISTINCT_REVIEWER_COUNT");
  });

  it("allows one receipt to affect the score only once", async () => {
    const proof = makePaymentProof({
      clientAddress: REVIEWERS[0],
      txHash: bytes32("a"),
      logIndex: 1,
    });
    const first = makeFeedback({
      clientAddress: REVIEWERS[0],
      feedbackIndex: 1n,
      value: 80n,
      proofOfPayment: proof,
    });
    const replay = makeFeedback({
      clientAddress: REVIEWERS[0],
      feedbackIndex: 2n,
      value: 100n,
      proofOfPayment: proof,
      observedAtBlock: 102n,
    });
    const result = await assessB2GroundedReputation({
      feedback: [first, replay],
      identity: IDENTITY,
      scope,
      paymentProofVerifier: new MapPaymentProofVerifier(
        new Map([[proof.txHash.toLowerCase(), verifiedEvidence(proof)]]),
      ),
    });

    expect(result.scoreBps).toBe(8_000);
    expect(result.acceptedFeedback).toHaveLength(1);
    expect(result.rejectedFeedback[0]?.reason).toBe("RECEIPT_REPLAY");
  });
});
