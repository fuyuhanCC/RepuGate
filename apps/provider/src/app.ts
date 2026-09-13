import {
  canonicalizeHttpUrl,
  canonicalizeOffer,
  createDeterministicScenario,
  DETERMINISTIC_SCENARIO_IDS,
} from "@repugate/core";
import type {
  Address,
  CanonicalOffer,
  DeterministicScenarioId,
} from "@repugate/core";
import {
  decodeX402Header,
  encodeX402Header,
  paymentPayloadSchema,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  repugateAgentInfoSchema,
} from "@repugate/x402";
import type {
  ExactEvmPaymentRequirements,
  PaymentPayload,
  PaymentRequired,
} from "@repugate/x402";
import Fastify from "fastify";
import type { FastifyInstance, FastifyReply } from "fastify";

export type ProviderBehaviour = "HONEST" | "OFFER_SUBSTITUTION";

export interface BuildProviderOptions {
  logger?: boolean;
}

const TRANSACTION_BYTES: Record<DeterministicScenarioId, string> = {
  "honest-service": "11",
  "ungrounded-feedback": "22",
  "receipt-replay": "33",
  "reviewer-concentration": "44",
  "offer-substitution": "55",
};

function scenarioId(value: string): DeterministicScenarioId | null {
  return (DETERMINISTIC_SCENARIO_IDS as readonly string[]).includes(value)
    ? (value as DeterministicScenarioId)
    : null;
}

function behaviourFor(id: DeterministicScenarioId): ProviderBehaviour {
  return id === "offer-substitution" ? "OFFER_SUBSTITUTION" : "HONEST";
}

function transactionHashFor(id: DeterministicScenarioId): `0x${string}` {
  return `0x${TRANSACTION_BYTES[id].repeat(32)}`;
}

function requirementsFor(offer: CanonicalOffer): ExactEvmPaymentRequirements {
  return {
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
  };
}

function paymentRequiredFor(
  id: DeterministicScenarioId,
): { offer: CanonicalOffer; required: PaymentRequired } {
  const scenario = createDeterministicScenario(id, "B3_REPUGATE");
  const offer = canonicalizeOffer(scenario.input.offer).offer;

  return {
    offer,
    required: {
      x402Version: 2,
      error: "PAYMENT-SIGNATURE header is required",
      resource: {
        url: offer.resourceUrl,
        description: scenario.description,
        mimeType: "application/json",
        serviceName: "RepuGate Independent Demo Provider",
        tags: ["ai-agent", "inference", id],
      },
      accepts: [requirementsFor(offer)],
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
    },
  };
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function validatePaymentPayload(
  payload: PaymentPayload,
  required: PaymentRequired,
  offer: CanonicalOffer,
): string | null {
  const accepted = payload.accepted;
  const expected = requirementsFor(offer);

  if (
    canonicalizeHttpUrl(payload.resource.url) !==
    canonicalizeHttpUrl(required.resource.url)
  ) {
    return "RESOURCE_MISMATCH";
  }
  if (
    accepted.scheme !== expected.scheme ||
    accepted.network !== expected.network ||
    accepted.amount !== expected.amount ||
    !sameHex(accepted.asset, expected.asset) ||
    !sameHex(accepted.payTo, expected.payTo) ||
    accepted.maxTimeoutSeconds !== expected.maxTimeoutSeconds
  ) {
    return "ACCEPTED_OFFER_MISMATCH";
  }
  if (
    accepted.extra?.assetTransferMethod !== "eip3009" ||
    accepted.extra.paymentFlow !== "authorization"
  ) {
    return "UNSUPPORTED_PAYMENT_FLOW";
  }
  if (
    !sameHex(payload.payload.authorization.to, offer.payTo) ||
    payload.payload.authorization.value !== offer.amount.toString()
  ) {
    return "AUTHORIZATION_MISMATCH";
  }

  const agent = repugateAgentInfoSchema.safeParse(
    payload.extensions?.["repugate-agent"]?.info,
  );
  if (
    !agent.success ||
    !sameHex(agent.data.agentRegistry, offer.agent.registry) ||
    agent.data.agentId !== offer.agent.agentId.toString() ||
    !sameHex(agent.data.endpointHash, offer.endpointHash)
  ) {
    return "AGENT_EXTENSION_MISMATCH";
  }

  return null;
}

function paymentChallenge(
  reply: FastifyReply,
  required: PaymentRequired,
  error: string,
): unknown {
  return reply
    .code(402)
    .header(PAYMENT_REQUIRED_HEADER, encodeX402Header({ ...required, error }))
    .header("cache-control", "no-store")
    .send({ error: "payment_required", code: error });
}

export function buildProviderApp(
  options: BuildProviderOptions = {},
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/provider/health", async () => ({
    status: "ok",
    settlement: "simulated",
  }));

  app.post<{ Params: { scenarioId: string } }>(
    "/provider/services/:scenarioId/inference",
    async (request, reply) => {
      const id = scenarioId(request.params.scenarioId);
      if (id === null) {
        return reply.code(404).send({
          error: "scenario_not_found",
          code: "SCENARIO_NOT_FOUND",
        });
      }

      const behaviour = behaviourFor(id);
      const { offer, required } = paymentRequiredFor(id);
      const header = request.headers[PAYMENT_SIGNATURE_HEADER.toLowerCase()];

      if (typeof header !== "string") {
        return paymentChallenge(
          reply,
          required,
          "PAYMENT_SIGNATURE_REQUIRED",
        );
      }

      let payload: PaymentPayload;
      try {
        payload = decodeX402Header(header, paymentPayloadSchema);
      } catch {
        return paymentChallenge(reply, required, "INVALID_PAYMENT_PAYLOAD");
      }

      const validationError = validatePaymentPayload(payload, required, offer);
      if (validationError !== null) {
        return paymentChallenge(reply, required, validationError);
      }

      const transaction = transactionHashFor(id);
      return reply
        .header(
          PAYMENT_RESPONSE_HEADER,
          encodeX402Header({
            success: true,
            payer: payload.payload.authorization.from as Address,
            transaction,
            network: offer.network,
            amount: offer.amount.toString(),
            extensions: {
              settlement: "simulated",
              providerBehaviour: behaviour,
            },
          }),
        )
        .header("cache-control", "no-store")
        .send({
          result: "Inference completed by the independent demo provider.",
          scenario: id,
          providerBehaviour: behaviour,
          settlement: "simulated",
        });
    },
  );

  return app;
}
