import { describe, expect, it } from "vitest";

import { canonicalOfferInputSchema } from "./offer";

const validOffer = {
  method: "POST",
  resourceUrl: "https://provider.example/services/honest/inference",
  endpointHash:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  requestBodyHash:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  scheme: "exact",
  network: "eip155:84532",
  asset: "0x3333333333333333333333333333333333333333",
  amount: "10000",
  payTo: "0x4444444444444444444444444444444444444444",
  maxTimeoutSeconds: 60,
  agent: {
    chainId: 84532,
    registry: "0x5555555555555555555555555555555555555555",
    agentId: "12",
  },
} as const;

describe("canonicalOfferInputSchema", () => {
  it("accepts a valid exact EVM offer", () => {
    expect(canonicalOfferInputSchema.parse(validOffer)).toEqual(validOffer);
  });

  it("rejects an invalid EVM address", () => {
    const result = canonicalOfferInputSchema.safeParse({
      ...validOffer,
      payTo: "0x1234",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-integer token amount", () => {
    const result = canonicalOfferInputSchema.safeParse({
      ...validOffer,
      amount: "1.5",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-HTTP resource URL", () => {
    const result = canonicalOfferInputSchema.safeParse({
      ...validOffer,
      resourceUrl: "file:///tmp/provider-response.json",
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown fields", () => {
    const result = canonicalOfferInputSchema.safeParse({
      ...validOffer,
      untrustedOverride: true,
    });

    expect(result.success).toBe(false);
  });
});
