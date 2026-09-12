import { encodeAbiParameters, getAddress, keccak256 } from "viem";

import type {
  Bytes32,
  CanonicalOffer,
  CanonicalizedOffer,
  EvmNetwork,
  HttpMethod,
} from "../domain/types";
import {
  canonicalOfferInputSchema,
  type CanonicalOfferInput,
} from "../schemas/offer";
import { canonicalizeHttpUrl } from "./http-url";

const CANONICAL_OFFER_ABI = [
  { name: "method", type: "string" },
  { name: "resourceUrl", type: "string" },
  { name: "endpointHash", type: "bytes32" },
  { name: "requestBodyHash", type: "bytes32" },
  { name: "scheme", type: "string" },
  { name: "network", type: "string" },
  { name: "asset", type: "address" },
  { name: "amount", type: "uint256" },
  { name: "payTo", type: "address" },
  { name: "maxTimeoutSeconds", type: "uint256" },
  { name: "identityChainId", type: "uint256" },
  { name: "agentRegistry", type: "address" },
  { name: "agentId", type: "uint256" },
] as const;

export type OfferCanonicalizationErrorCode =
  | "NETWORK_CHAIN_MISMATCH"
  | "UNSUPPORTED_HTTP_METHOD";

export class OfferCanonicalizationError extends Error {
  constructor(
    public readonly code: OfferCanonicalizationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OfferCanonicalizationError";
  }
}

function canonicalizeMethod(method: string): HttpMethod {
  const normalized = method.toUpperCase();

  if (normalized !== "GET" && normalized !== "POST") {
    throw new OfferCanonicalizationError(
      "UNSUPPORTED_HTTP_METHOD",
      `Unsupported HTTP method: ${method}`,
    );
  }

  return normalized;
}

function assertMatchingChainIds(network: string, identityChainId: number): void {
  const networkChainId = BigInt(network.slice("eip155:".length));

  if (networkChainId !== BigInt(identityChainId)) {
    throw new OfferCanonicalizationError(
      "NETWORK_CHAIN_MISMATCH",
      `Payment network ${network} does not match identity chain ${identityChainId}`,
    );
  }
}

export function canonicalizeOffer(
  input: CanonicalOfferInput,
): CanonicalizedOffer {
  const parsed = canonicalOfferInputSchema.parse(input);

  assertMatchingChainIds(parsed.network, parsed.agent.chainId);

  const offer: CanonicalOffer = {
    method: canonicalizeMethod(parsed.method),
    resourceUrl: canonicalizeHttpUrl(parsed.resourceUrl),
    endpointHash: parsed.endpointHash as Bytes32,
    requestBodyHash: parsed.requestBodyHash as Bytes32,
    scheme: parsed.scheme,
    network: parsed.network as EvmNetwork,
    asset: getAddress(parsed.asset),
    amount: BigInt(parsed.amount),
    payTo: getAddress(parsed.payTo),
    maxTimeoutSeconds: parsed.maxTimeoutSeconds,
    agent: {
      chainId: parsed.agent.chainId,
      registry: getAddress(parsed.agent.registry),
      agentId: BigInt(parsed.agent.agentId),
    },
  };

  const encodedOffer = encodeAbiParameters(CANONICAL_OFFER_ABI, [
    offer.method,
    offer.resourceUrl,
    offer.endpointHash,
    offer.requestBodyHash,
    offer.scheme,
    offer.network,
    offer.asset,
    offer.amount,
    offer.payTo,
    BigInt(offer.maxTimeoutSeconds),
    BigInt(offer.agent.chainId),
    offer.agent.registry,
    offer.agent.agentId,
  ]);

  return {
    offer,
    encodedOffer,
    offerHash: keccak256(encodedOffer),
  };
}
