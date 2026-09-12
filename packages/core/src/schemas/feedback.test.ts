import { describe, expect, it } from "vitest";

import {
  createAuthorizationKey,
  createReceiptKey,
} from "../evidence/receipt-key";
import type { Bytes32 } from "../domain/types";
import {
  feedbackRecordInputSchema,
  paymentProofInputSchema,
  signedInt128StringSchema,
} from "./feedback";

const txHash =
  "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" as Bytes32;
const nonce =
  "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" as Bytes32;

const validFeedback = {
  agent: {
    chainId: 84532,
    registry: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
    agentId: "12",
  },
  clientAddress: "0x1111111111111111111111111111111111111111",
  feedbackIndex: "1",
  value: "8750",
  valueDecimals: 2,
  tag1: "quality",
  tag2: "inference",
  endpoint: "https://provider.example/services/honest/inference",
  feedbackUri: "ipfs://bafybeigdyrzt-example",
  feedbackHash:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  isRevoked: false,
  observedAtBlock: "123456",
  proofOfPayment: {
    chainId: "84532",
    txHash,
    fromAddress: "0x1111111111111111111111111111111111111111",
    toAddress: "0x209693bc6afc0c5328ba36faf03c514ef312287c",
    logIndex: 3,
    authorizationNonce: nonce,
  },
} as const;

describe("feedbackRecordInputSchema", () => {
  it("accepts an ERC-8004 quality feedback record with payment proof", () => {
    expect(feedbackRecordInputSchema.parse(validFeedback)).toEqual(validFeedback);
  });

  it("allows feedback without payment proof at the input boundary", () => {
    const { proofOfPayment: _proof, ...withoutProof } = validFeedback;

    expect(feedbackRecordInputSchema.safeParse(withoutProof).success).toBe(true);
  });

  it("rejects valueDecimals outside the ERC-8004 range", () => {
    expect(
      feedbackRecordInputSchema.safeParse({
        ...validFeedback,
        valueDecimals: 19,
      }).success,
    ).toBe(false);
  });

  it("rejects untrusted unknown fields", () => {
    expect(
      feedbackRecordInputSchema.safeParse({
        ...validFeedback,
        scoreOverride: 100,
      }).success,
    ).toBe(false);
  });
});

describe("signedInt128StringSchema", () => {
  const minimum = -(1n << 127n);
  const maximum = (1n << 127n) - 1n;

  it.each([minimum.toString(), "-1", "0", "1", maximum.toString()])(
    "accepts %s",
    (value) => {
      expect(signedInt128StringSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each([
    (minimum - 1n).toString(),
    (maximum + 1n).toString(),
    "-0",
    "01",
    "1.5",
  ])("rejects %s", (value) => {
    expect(signedInt128StringSchema.safeParse(value).success).toBe(false);
  });
});

describe("paymentProofInputSchema", () => {
  it("accepts the minimal proof fields described by ERC-8004", () => {
    const result = paymentProofInputSchema.safeParse({
      chainId: "84532",
      txHash,
      fromAddress: "0x1111111111111111111111111111111111111111",
      toAddress: "0x209693bc6afc0c5328ba36faf03c514ef312287c",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid transaction hash", () => {
    expect(
      paymentProofInputSchema.safeParse({
        ...validFeedback.proofOfPayment,
        txHash: "0x1234",
      }).success,
    ).toBe(false);
  });
});

describe("payment evidence keys", () => {
  it("creates a canonical Transfer-log receipt key", () => {
    expect(createReceiptKey({ chainId: 84532, txHash, logIndex: 3 })).toBe(
      `eip155:84532:tx:${txHash.toLowerCase()}:log:3`,
    );
  });

  it("creates a canonical EIP-3009 authorization key", () => {
    expect(createAuthorizationKey(84532, nonce)).toBe(
      `eip155:84532:nonce:${nonce.toLowerCase()}`,
    );
  });
});
