import { describe, expect, it } from "vitest";

import type {
  PaymentProofVerification,
  VerifiedPaymentEvidence,
} from "../domain/evidence";
import type { FeedbackRecord } from "../domain/reputation";
import type { Address } from "../domain/types";
import { createReceiptKey } from "../evidence/receipt-key";
import { FixtureReceiptUsageReader } from "../fixtures/adapters";
import {
  AGENT_WALLET,
  bytes32,
  IDENTITY,
  makeFeedback,
  makePaymentProof,
  MapPaymentProofVerifier,
  REVIEWERS,
  verifiedEvidence,
} from "../testing/fixtures";
import { assessB3Reputation } from "./b3";
import { createFeedbackKey } from "./quality-feedback";

const scope = {
  agent: IDENTITY.agent,
  endpoint: IDENTITY.registeredEndpoint,
  tag1: "quality",
  tag2: "inference",
};

function paidFeedback(input: {
  reviewer: Address;
  feedbackIndex: number;
  score: number;
  txByte: string;
  nonceByte?: string;
}): {
  feedback: FeedbackRecord;
  verification: VerifiedPaymentEvidence;
} {
  const proof = makePaymentProof({
    clientAddress: input.reviewer,
    txHash: bytes32(input.txByte),
    logIndex: input.feedbackIndex,
    ...(input.nonceByte === undefined
      ? {}
      : { authorizationNonce: bytes32(input.nonceByte) }),
  });

  return {
    feedback: makeFeedback({
      clientAddress: input.reviewer,
      feedbackIndex: BigInt(input.feedbackIndex),
      value: BigInt(input.score),
      proofOfPayment: proof,
      observedAtBlock: BigInt(100 + input.feedbackIndex),
    }),
    verification: verifiedEvidence(proof),
  };
}

function verifierFor(
  items: readonly {
    feedback: FeedbackRecord;
    verification: PaymentProofVerification;
  }[],
): MapPaymentProofVerifier {
  return new MapPaymentProofVerifier(
    new Map(
      items.map((item) => [
        item.feedback.proofOfPayment!.txHash.toLowerCase(),
        item.verification,
      ]),
    ),
  );
}

describe("B3 payment-grounded reputation", () => {
  it("rejects ungrounded feedback without calling the chain verifier", async () => {
    const verifier = new MapPaymentProofVerifier(new Map());
    const feedback = REVIEWERS.map((clientAddress, index) =>
      makeFeedback({
        clientAddress,
        feedbackIndex: BigInt(index + 1),
        value: 100n,
      }),
    );

    const result = await assessB3Reputation({
      feedback,
      identity: IDENTITY,
      scope,
      paymentProofVerifier: verifier,
    });

    expect(result.scoreBps).toBeNull();
    expect(result.acceptedFeedback).toHaveLength(0);
    expect(result.rejectedFeedback).toHaveLength(5);
    expect(result.riskFlags).toContain("UNGROUNDED_FEEDBACK_PRESENT");
    expect(verifier.calls).toHaveLength(0);
  });

  it("allows one receipt and authorization nonce to contribute only once", async () => {
    const first = paidFeedback({
      reviewer: REVIEWERS[0],
      feedbackIndex: 1,
      score: 90,
      txByte: "a",
      nonceByte: "1",
    });
    const receiptReplay = {
      feedback: makeFeedback({
        ...first.feedback,
        feedbackIndex: 2n,
        observedAtBlock: 102n,
      }),
      verification: first.verification,
    };
    const nonceReplay = paidFeedback({
      reviewer: REVIEWERS[0],
      feedbackIndex: 3,
      score: 100,
      txByte: "b",
      nonceByte: "1",
    });
    const verifier = verifierFor([first, receiptReplay, nonceReplay]);

    const result = await assessB3Reputation({
      feedback: [nonceReplay.feedback, receiptReplay.feedback, first.feedback],
      identity: IDENTITY,
      scope,
      paymentProofVerifier: verifier,
    });

    expect(result.scoreBps).toBe(9_000);
    expect(result.acceptedFeedback).toHaveLength(1);
    expect(
      result.rejectedFeedback.filter(
        (item) => item.reason === "RECEIPT_REPLAY",
      ),
    ).toHaveLength(2);
    expect(result.riskFlags).toContain("REPLAY_ATTEMPT_PRESENT");
  });

  it("gives each distinct reviewer equal weight", async () => {
    const items = [
      paidFeedback({
        reviewer: REVIEWERS[0],
        feedbackIndex: 1,
        score: 100,
        txByte: "a",
      }),
      paidFeedback({
        reviewer: REVIEWERS[0],
        feedbackIndex: 2,
        score: 0,
        txByte: "b",
      }),
      paidFeedback({
        reviewer: REVIEWERS[1],
        feedbackIndex: 3,
        score: 80,
        txByte: "c",
      }),
    ];

    const result = await assessB3Reputation({
      feedback: items.map((item) => item.feedback),
      identity: IDENTITY,
      scope,
      paymentProofVerifier: verifierFor(items),
    });

    expect(result.scoreBps).toBe(6_500);
    expect(result.distinctReviewerCount).toBe(2);
  });

  it("scores three honest, independently paying reviewers", async () => {
    const items = [80, 90, 100].map((score, index) =>
      paidFeedback({
        reviewer: REVIEWERS[index],
        feedbackIndex: index + 1,
        score,
        txByte: String(index + 1),
      }),
    );

    const result = await assessB3Reputation({
      feedback: items.map((item) => item.feedback),
      identity: IDENTITY,
      scope,
      paymentProofVerifier: verifierFor(items),
    });

    expect(result.scoreBps).toBe(9_000);
    expect(result.confidenceBps).toBe(6_000);
    expect(result.distinctReviewerCount).toBe(3);
  });

  it("rejects payments whose payer or recipient is not bound to the review", async () => {
    const payerProof = makePaymentProof({
      clientAddress: REVIEWERS[1],
      txHash: bytes32("a"),
    });
    const payerMismatch = {
      feedback: makeFeedback({
        clientAddress: REVIEWERS[0],
        feedbackIndex: 1n,
        proofOfPayment: payerProof,
      }),
      verification: verifiedEvidence(payerProof),
    };
    const attacker =
      "0x9999999999999999999999999999999999999999" as Address;
    const recipientProof = makePaymentProof({
      clientAddress: REVIEWERS[2],
      txHash: bytes32("b"),
      recipient: attacker,
    });
    const recipientMismatch = {
      feedback: makeFeedback({
        clientAddress: REVIEWERS[2],
        feedbackIndex: 2n,
        proofOfPayment: recipientProof,
      }),
      verification: verifiedEvidence(recipientProof),
    };

    const result = await assessB3Reputation({
      feedback: [payerMismatch.feedback, recipientMismatch.feedback],
      identity: IDENTITY,
      scope,
      paymentProofVerifier: verifierFor([
        payerMismatch,
        recipientMismatch,
      ]),
    });

    expect(result.rejectedFeedback.map((item) => item.reason)).toEqual([
      "PAYER_MISMATCH",
      "RECIPIENT_MISMATCH",
    ]);
    expect(result.scoreBps).toBeNull();
    expect(AGENT_WALLET).not.toBe(attacker);
  });

  it("treats an existing claim by another feedback record as replay", async () => {
    const item = paidFeedback({
      reviewer: REVIEWERS[0],
      feedbackIndex: 1,
      score: 90,
      txByte: "a",
    });
    const receiptKey = createReceiptKey(item.verification.receipt);
    const receiptUsageReader = new FixtureReceiptUsageReader(
      new Map([[receiptKey, { feedbackKey: "another-feedback-record" }]]),
    );

    const result = await assessB3Reputation({
      feedback: [item.feedback],
      identity: IDENTITY,
      scope,
      paymentProofVerifier: verifierFor([item]),
      receiptUsageReader,
    });

    expect(result.acceptedFeedback).toHaveLength(0);
    expect(result.rejectedFeedback[0]?.reason).toBe("RECEIPT_REPLAY");
  });

  it("accepts an existing claim owned by the same feedback record", async () => {
    const item = paidFeedback({
      reviewer: REVIEWERS[0],
      feedbackIndex: 1,
      score: 90,
      txByte: "a",
    });
    const receiptKey = createReceiptKey(item.verification.receipt);
    const receiptUsageReader = new FixtureReceiptUsageReader(
      new Map([
        [
          receiptKey,
          { feedbackKey: createFeedbackKey(item.feedback) },
        ],
      ]),
    );

    const result = await assessB3Reputation({
      feedback: [item.feedback],
      identity: IDENTITY,
      scope,
      paymentProofVerifier: verifierFor([item]),
      receiptUsageReader,
    });

    expect(result.acceptedFeedback).toHaveLength(1);
  });

  it("rejects payment evidence created after the feedback", async () => {
    const item = paidFeedback({
      reviewer: REVIEWERS[0],
      feedbackIndex: 1,
      score: 90,
      txByte: "a",
    });
    const latePayment = {
      ...item,
      verification: {
        ...item.verification,
        settledAtBlock: item.feedback.observedAtBlock + 1n,
      },
    };

    const result = await assessB3Reputation({
      feedback: [latePayment.feedback],
      identity: IDENTITY,
      scope,
      paymentProofVerifier: verifierFor([latePayment]),
    });

    expect(result.rejectedFeedback[0]?.reason).toBe(
      "PAYMENT_AFTER_FEEDBACK",
    );
  });
});
