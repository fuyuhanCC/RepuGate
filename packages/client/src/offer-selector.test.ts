import { describe, expect, it } from "vitest";

import type { Address, EvmNetwork } from "@repugate/core";

import { TrustedFetchError } from "./errors";
import { selectExactEvmOffer } from "./offer-selector";
import type { PaymentRequirements } from "./x402/schemas";

const ASSET = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Address;
const NETWORK = "eip155:84532" as EvmNetwork;

function offer(
  amount: string,
  payTo = "0x209693bc6afc0c5328ba36faf03c514ef312287c",
  extra?: Record<string, unknown>,
): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    amount,
    asset: ASSET,
    payTo,
    maxTimeoutSeconds: 60,
    ...(extra === undefined ? {} : { extra }),
  };
}

const policy = {
  network: NETWORK,
  asset: ASSET,
  maxAmount: 20_000n,
  maxTimeoutSeconds: 60,
};

describe("selectExactEvmOffer", () => {
  it("deterministically selects the cheapest acceptable entry", () => {
    const selected = selectExactEvmOffer(
      [offer("20000"), offer("10000"), offer("15000")],
      policy,
    );

    expect(selected.amount).toBe("10000");
  });

  it.each([
    ["upfront flow", offer("10000", undefined, { paymentFlow: "upfront" })],
    ["permit2 transfer", offer("10000", undefined, { assetTransferMethod: "permit2" })],
    ["over budget", offer("20001")],
    ["wrong network", { ...offer("10000"), network: "eip155:1" }],
  ])("rejects an unsupported %s without falling back unsafely", (_label, entry) => {
    expect(() => selectExactEvmOffer([entry], policy)).toThrowError(
      expect.objectContaining<Partial<TrustedFetchError>>({
        code: "NO_ACCEPTABLE_OFFER",
      }),
    );
  });

  it("accepts explicit authorization with EIP-3009", () => {
    const selected = selectExactEvmOffer(
      [
        offer("10000", undefined, {
          paymentFlow: "authorization",
          assetTransferMethod: "eip3009",
        }),
      ],
      policy,
    );

    expect(selected.amount).toBe("10000");
  });
});
