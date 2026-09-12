import { describe, expect, it } from "vitest";

import type { CanonicalOfferInput } from "../schemas/offer";
import { HttpUrlCanonicalizationError } from "./http-url";
import {
  canonicalizeOffer,
  OfferCanonicalizationError,
} from "./offer";

const baseOffer: CanonicalOfferInput = {
  method: "post",
  resourceUrl:
    "HTTPS://Provider.Example:443/services/../services/honest/inference#result",
  endpointHash:
    "0x1111111111111111111111111111111111111111111111111111111111111111",
  requestBodyHash:
    "0x2222222222222222222222222222222222222222222222222222222222222222",
  scheme: "exact",
  network: "eip155:84532",
  asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "10000",
  payTo: "0x209693bc6afc0c5328ba36faf03c514ef312287c",
  maxTimeoutSeconds: 60,
  agent: {
    chainId: 84532,
    registry: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
    agentId: "12",
  },
};

describe("canonicalizeOffer", () => {
  it("normalizes method, URL, and EVM addresses", () => {
    const result = canonicalizeOffer(baseOffer);

    expect(result.offer.method).toBe("POST");
    expect(result.offer.resourceUrl).toBe(
      "https://provider.example/services/honest/inference",
    );
    expect(result.offer.asset).toBe(
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    );
    expect(result.offer.amount).toBe(10_000n);
    expect(result.offer.agent.agentId).toBe(12n);
  });

  it("produces the same hash for semantically equivalent input", () => {
    const first = canonicalizeOffer(baseOffer);
    const second = canonicalizeOffer({
      ...baseOffer,
      method: "POST",
      resourceUrl: "https://provider.example/services/honest/inference",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    });

    expect(second.encodedOffer).toBe(first.encodedOffer);
    expect(second.offerHash).toBe(first.offerHash);
  });

  it.each([
    ["amount", { amount: "10001" }],
    ["payTo", { payTo: "0x4444444444444444444444444444444444444444" }],
    ["resource URL", { resourceUrl: "https://provider.example/services/other" }],
    [
      "request body",
      {
        requestBodyHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    ],
    ["agent identity", { agent: { ...baseOffer.agent, agentId: "13" } }],
  ])("changes the hash when %s changes", (_label, override) => {
    const original = canonicalizeOffer(baseOffer);
    const changed = canonicalizeOffer({ ...baseOffer, ...override });

    expect(changed.offerHash).not.toBe(original.offerHash);
  });

  it("rejects a payment and identity chain mismatch", () => {
    expect(() =>
      canonicalizeOffer({
        ...baseOffer,
        agent: { ...baseOffer.agent, chainId: 1 },
      }),
    ).toThrowError(
      expect.objectContaining<Partial<OfferCanonicalizationError>>({
        code: "NETWORK_CHAIN_MISMATCH",
      }),
    );
  });

  it("rejects unsupported HTTP methods", () => {
    expect(() => canonicalizeOffer({ ...baseOffer, method: "DELETE" })).toThrowError(
      expect.objectContaining<Partial<OfferCanonicalizationError>>({
        code: "UNSUPPORTED_HTTP_METHOD",
      }),
    );
  });

  it("rejects resource URLs containing credentials", () => {
    expect(() =>
      canonicalizeOffer({
        ...baseOffer,
        resourceUrl: "https://buyer:secret@provider.example/inference",
      }),
    ).toThrowError(
      expect.objectContaining<Partial<HttpUrlCanonicalizationError>>({
        code: "URL_CREDENTIALS_NOT_ALLOWED",
      }),
    );
  });

  it("matches the frozen offer-hash vector", () => {
    const result = canonicalizeOffer(baseOffer);

    expect(result.offerHash).toBe(
      "0x1b4309e3de9a3e1004bedbf7bdbac11d19b3ad3651a4e483af5b9b0038d9eb17",
    );
  });
});
