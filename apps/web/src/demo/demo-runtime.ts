import type {
  FetchPort,
  IdempotencyKeyGenerator,
  SignedEvmAuthorization,
  WalletPort,
} from "@repugate/client";
import {
  decodeX402Header,
  encodeX402Header,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from "@repugate/client";
import type { Address, AuthorizedPaymentIntent } from "@repugate/core";
import { canonicalizeOffer } from "@repugate/core";
import { z } from "zod";

import type { ServiceCatalogItem } from "../api/dto";

const DEMO_BUYER =
  "0x08a4c0449ba864B1f463c2ab663014C3a07bE375" as Address;
const DEMO_SIGNATURE = `0x${"42".repeat(65)}` as const;
const DEMO_NONCE = `0x${"24".repeat(32)}` as const;

const paymentPayloadInspectionSchema = z
  .object({
    x402Version: z.literal(2),
    accepted: z.object({
      amount: z.string(),
      network: z.string(),
      payTo: z.string(),
    }).passthrough(),
    payload: z.object({
      authorization: z.object({ from: z.string() }).passthrough(),
    }).passthrough(),
  })
  .passthrough();

function transactionHashFor(serviceId: ServiceCatalogItem["id"]): `0x${string}` {
  const byte = {
    "honest-service": "11",
    "ungrounded-feedback": "22",
    "receipt-replay": "33",
    "reviewer-concentration": "44",
    "offer-substitution": "55",
  }[serviceId];

  return `0x${byte.repeat(32)}`;
}

export class DemoWallet implements WalletPort {
  readonly address = DEMO_BUYER;
  readonly chainId = 84_532;
  signCount = 0;

  async getAddress(): Promise<Address> {
    return this.address;
  }

  async getChainId(): Promise<number> {
    return this.chainId;
  }

  async signX402Authorization(
    intent: AuthorizedPaymentIntent,
  ): Promise<SignedEvmAuthorization> {
    this.signCount += 1;

    return {
      signature: DEMO_SIGNATURE,
      authorization: {
        from: this.address,
        to: intent.offer.payTo,
        value: intent.offer.amount.toString(),
        validAfter: "1700000000",
        validBefore: "1700000060",
        nonce: DEMO_NONCE,
      },
    };
  }
}

export class DemoProviderFetch implements FetchPort {
  requestCount = 0;
  paidRequestObserved = false;

  constructor(private readonly service: ServiceCatalogItem) {}

  async fetch(input: string, init: RequestInit): Promise<Response> {
    this.requestCount += 1;
    const offer = canonicalizeOffer(this.service.offer).offer;
    const headers = new Headers(init.headers);
    const paymentSignature = headers.get(PAYMENT_SIGNATURE_HEADER);

    if (input !== offer.resourceUrl) {
      return new Response("unknown resource", { status: 404 });
    }

    if (paymentSignature === null) {
      const paymentRequired = {
        x402Version: 2,
        error: "PAYMENT-SIGNATURE header is required",
        resource: {
          url: offer.resourceUrl,
          description: this.service.description,
          mimeType: "application/json",
          serviceName: "RepuGate Demo Provider",
          tags: ["ai-agent", "inference"],
        },
        accepts: [
          {
            scheme: "exact",
            network: offer.network,
            amount: offer.amount.toString(),
            asset: offer.asset,
            payTo: offer.payTo,
            maxTimeoutSeconds: offer.maxTimeoutSeconds,
            extra: {
              assetTransferMethod: "eip3009",
              paymentFlow: "authorization",
              name: "USDC",
              version: "2",
            },
          },
        ],
        extensions: {
          "repugate-agent": {
            info: {
              agentRegistry: offer.agent.registry,
              agentId: offer.agent.agentId.toString(),
              endpointHash: offer.endpointHash,
            },
            schema: {
              type: "object",
              required: ["agentRegistry", "agentId", "endpointHash"],
            },
          },
        },
      };

      return new Response(JSON.stringify({ error: "payment_required" }), {
        status: 402,
        headers: {
          "content-type": "application/json",
          [PAYMENT_REQUIRED_HEADER]: encodeX402Header(paymentRequired),
        },
      });
    }

    const payload = decodeX402Header(
      paymentSignature,
      paymentPayloadInspectionSchema,
      "INVALID_PAYMENT_REQUIRED",
    );
    if (
      payload.accepted.amount !== offer.amount.toString() ||
      payload.accepted.network !== offer.network ||
      payload.accepted.payTo.toLowerCase() !== offer.payTo.toLowerCase() ||
      payload.payload.authorization.from.toLowerCase() !==
        DEMO_BUYER.toLowerCase()
    ) {
      return new Response(JSON.stringify({ error: "invalid_payment" }), {
        status: 402,
      });
    }

    this.paidRequestObserved = true;
    const transaction = transactionHashFor(this.service.id);

    return new Response(
      JSON.stringify({
        result: "Inference completed by the deterministic demo provider.",
        service: this.service.id,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          [PAYMENT_RESPONSE_HEADER]: encodeX402Header({
            success: true,
            payer: DEMO_BUYER,
            transaction,
            network: offer.network,
            amount: offer.amount.toString(),
          }),
        },
      },
    );
  }
}

export class BrowserIdempotencyKeys implements IdempotencyKeyGenerator {
  next(scope: "consume" | "evaluate" | "payment-event"): string {
    return `${scope}-${crypto.randomUUID()}`;
  }
}

export const DEMO_BUYER_ADDRESS = DEMO_BUYER;
