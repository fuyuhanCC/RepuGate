import { describe, expect, it } from "vitest";

import type { FeedbackRecordInput } from "../schemas/feedback";
import { normalizeFeedbackRecord } from "./normalize-feedback";

const fullFeedback: FeedbackRecordInput = {
  agent: {
    chainId: 84532,
    registry: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
    agentId: "12",
  },
  clientAddress: "0x857b06519e91e3a54538791bdbb0e22373e36b66",
  feedbackIndex: "7",
  value: "8750",
  valueDecimals: 2,
  tag1: "quality",
  tag2: "inference",
  endpoint: "HTTPS://Provider.Example:443/services/honest#feedback",
  feedbackUri: "https://Evidence.Example:443/reviews/7.json#download",
  feedbackHash:
    "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  isRevoked: false,
  observedAtBlock: "123456",
  proofOfPayment: {
    chainId: "84532",
    txHash:
      "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    fromAddress: "0x857b06519e91e3a54538791bdbb0e22373e36b66",
    toAddress: "0x209693bc6afc0c5328ba36faf03c514ef312287c",
    logIndex: 3,
    authorizationNonce:
      "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  },
};

describe("normalizeFeedbackRecord", () => {
  it("normalizes a complete feedback record", () => {
    const feedback = normalizeFeedbackRecord(fullFeedback);

    expect(feedback.agent.agentId).toBe(12n);
    expect(feedback.clientAddress).toBe(
      "0x857b06519E91e3A54538791bDbb0E22373e36b66",
    );
    expect(feedback.feedbackIndex).toBe(7n);
    expect(feedback.value).toBe(8_750n);
    expect(feedback.observedAtBlock).toBe(123_456n);
    expect(feedback.endpoint).toBe(
      "https://provider.example/services/honest",
    );
    expect(feedback.feedbackUri).toBe(
      "https://evidence.example/reviews/7.json",
    );
    expect(feedback.feedbackHash).toBe(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });

  it("normalizes payment-proof identifiers and addresses", () => {
    const proof = normalizeFeedbackRecord(fullFeedback).proofOfPayment;

    expect(proof).toEqual({
      chainId: 84532,
      txHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      fromAddress: "0x857b06519E91e3A54538791bDbb0E22373e36b66",
      toAddress: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      logIndex: 3,
      authorizationNonce:
        "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    });
  });

  it("fills ERC-8004 defaults and omits empty optional values", () => {
    const feedback = normalizeFeedbackRecord({
      agent: fullFeedback.agent,
      clientAddress: fullFeedback.clientAddress,
      feedbackIndex: "1",
      value: "100",
      valueDecimals: 0,
      endpoint: "",
      feedbackUri: "",
      feedbackHash:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      observedAtBlock: "1",
    });

    expect(feedback.tag1).toBe("");
    expect(feedback.tag2).toBe("");
    expect(feedback.isRevoked).toBe(false);
    expect(feedback).not.toHaveProperty("endpoint");
    expect(feedback).not.toHaveProperty("feedbackUri");
    expect(feedback).not.toHaveProperty("feedbackHash");
    expect(feedback).not.toHaveProperty("proofOfPayment");
  });

  it("preserves an IPFS feedback URI", () => {
    const feedback = normalizeFeedbackRecord({
      ...fullFeedback,
      feedbackUri: "ipfs://bafybeigdyrzt-example",
    });

    expect(feedback.feedbackUri).toBe("ipfs://bafybeigdyrzt-example");
  });

  it("rejects a payment chain ID outside JavaScript's safe range", () => {
    expect(() =>
      normalizeFeedbackRecord({
        ...fullFeedback,
        proofOfPayment: {
          ...fullFeedback.proofOfPayment!,
          chainId: (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(),
        },
      }),
    ).toThrow();
  });
});
