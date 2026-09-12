import type { Address, EvmNetwork } from "@repugate/core";

import { TrustedFetchError } from "./errors";
import {
  exactEvmPaymentRequirementsSchema,
  type ExactEvmPaymentRequirements,
  type PaymentRequirements,
} from "./x402/schemas";

export interface PaymentSelectionPolicy {
  network: EvmNetwork;
  asset: Address;
  maxAmount: bigint;
  maxTimeoutSeconds: number;
}

interface Candidate {
  offer: ExactEvmPaymentRequirements;
  amount: bigint;
  originalIndex: number;
}

function supportsAuthorizationFlow(
  offer: ExactEvmPaymentRequirements,
): boolean {
  const paymentFlow = offer.extra?.paymentFlow;
  const assetTransferMethod = offer.extra?.assetTransferMethod;

  return (
    (paymentFlow === undefined || paymentFlow === "authorization") &&
    (assetTransferMethod === undefined || assetTransferMethod === "eip3009")
  );
}

export function selectExactEvmOffer(
  accepts: readonly PaymentRequirements[],
  policy: PaymentSelectionPolicy,
): ExactEvmPaymentRequirements {
  if (policy.maxAmount <= 0n) {
    throw new RangeError("Payment budget must be positive");
  }
  if (
    !Number.isSafeInteger(policy.maxTimeoutSeconds) ||
    policy.maxTimeoutSeconds <= 0
  ) {
    throw new RangeError("Maximum timeout must be a positive safe integer");
  }

  const candidates: Candidate[] = [];

  for (const [originalIndex, offer] of accepts.entries()) {
    const parsed = exactEvmPaymentRequirementsSchema.safeParse(offer);
    if (!parsed.success) {
      continue;
    }

    const amount = BigInt(parsed.data.amount);
    if (
      parsed.data.network !== policy.network ||
      parsed.data.asset.toLowerCase() !== policy.asset.toLowerCase() ||
      amount > policy.maxAmount ||
      parsed.data.maxTimeoutSeconds > policy.maxTimeoutSeconds ||
      !supportsAuthorizationFlow(parsed.data)
    ) {
      continue;
    }

    candidates.push({ offer: parsed.data, amount, originalIndex });
  }

  candidates.sort((left, right) => {
    if (left.amount !== right.amount) {
      return left.amount < right.amount ? -1 : 1;
    }

    const payToOrder = left.offer.payTo
      .toLowerCase()
      .localeCompare(right.offer.payTo.toLowerCase());
    return payToOrder !== 0 ? payToOrder : left.originalIndex - right.originalIndex;
  });

  const selected = candidates[0];
  if (selected === undefined) {
    throw new TrustedFetchError(
      "NO_ACCEPTABLE_OFFER",
      "No exact EVM authorization offer satisfies the configured network, asset, budget, and timeout policy",
    );
  }

  return selected.offer;
}
