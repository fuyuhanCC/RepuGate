import { afterEach, describe, expect, it } from "vitest";

import type { FastifyInstance } from "fastify";

import { buildApp } from "./app";

const BUYER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

interface ServiceDto {
  id: string;
  offer: Record<string, unknown>;
  expectedOffer: Record<string, unknown>;
  expectedOfferHash: string;
}

interface EvaluationDto {
  decisionId: string;
  evaluation: {
    decision: "ALLOW" | "REVIEW" | "BLOCK";
    offerHash: string;
    policyHash: string;
    identity: { identityEpoch: string };
  };
  grant: null | {
    id: string;
    buyer: string;
    offerHash: string;
    identityEpoch: string;
    policyHash: string;
    expiresAt: number;
  };
}

interface PaymentDto {
  payment: {
    paymentId: string;
    state: string;
  };
  authorizedIntent: {
    offer: { amount: string };
  };
}

let app: FastifyInstance | undefined;
let now = 1_000;

afterEach(async () => {
  if (app !== undefined) {
    await app.close();
    app = undefined;
  }
});

function createApp(): FastifyInstance {
  let id = 0;
  now = 1_000;
  app = buildApp({
    databasePath: ":memory:",
    now: () => now,
    idGenerator: {
      next(prefix) {
        id += 1;
        return `${prefix}-${id}`;
      },
    },
  });
  return app;
}

async function getService(
  instance: FastifyInstance,
  id: string,
): Promise<ServiceDto> {
  const response = await instance.inject({
    method: "GET",
    url: "/api/services",
  });
  const body = response.json() as { services: ServiceDto[] };
  const service = body.services.find((candidate) => candidate.id === id);

  if (service === undefined) {
    throw new Error(`Missing fixture service: ${id}`);
  }

  return service;
}

describe("service catalog", () => {
  it("exposes the trusted offer separately from a substituted provider offer", async () => {
    const instance = createApp();
    const service = await getService(instance, "offer-substitution");

    expect(service.offer.amount).toBe("20000");
    expect(service.expectedOffer.amount).toBe("10000");
  });

  it("includes the reviewer-concentration ablation scenario", async () => {
    const instance = createApp();
    const service = await getService(instance, "reviewer-concentration");

    expect(service.offer.amount).toBe("10000");
  });
});

async function evaluate(
  instance: FastifyInstance,
  scenarioId = "honest-service",
  model = "B3_REPUGATE",
): Promise<{ statusCode: number; body: EvaluationDto }> {
  const service = await getService(instance, scenarioId);
  const response = await instance.inject({
    method: "POST",
    url: "/api/evaluations",
    payload: {
      buyer: BUYER,
      model,
      scenarioId,
      offer: service.offer,
      expectedOfferHash: service.expectedOfferHash,
      idempotencyKey: `evaluation-${scenarioId}-${model}`,
      tag2: "inference",
    },
  });

  return {
    statusCode: response.statusCode,
    body: response.json() as EvaluationDto,
  };
}

function consumptionPayload(grant: NonNullable<EvaluationDto["grant"]>) {
  return {
    buyer: grant.buyer,
    offerHash: grant.offerHash,
    identityEpoch: grant.identityEpoch,
    policyHash: grant.policyHash,
    idempotencyKey: "consume-request-1",
  };
}

describe("RepuGate API", () => {
  it("evaluates, issues an ALLOW grant, and retrieves the decision", async () => {
    const instance = createApp();
    const created = await evaluate(instance);

    expect(created.statusCode).toBe(201);
    expect(created.body.evaluation.decision).toBe("ALLOW");
    expect(created.body.grant).not.toBeNull();

    const retrieved = await instance.inject({
      method: "GET",
      url: `/api/evaluations/${created.body.decisionId}`,
    });

    expect(retrieved.statusCode).toBe(200);
    expect(retrieved.json()).toEqual(created.body);
  });

  it("persists a BLOCK decision without issuing a grant", async () => {
    const instance = createApp();
    const created = await evaluate(
      instance,
      "ungrounded-feedback",
      "B3_REPUGATE",
    );

    expect(created.statusCode).toBe(201);
    expect(created.body.evaluation.decision).toBe("BLOCK");
    expect(created.body.grant).toBeNull();
  });

  it("isolates B2 payment grounding from the B3 confidence gate", async () => {
    const instance = createApp();
    const b2 = await evaluate(
      instance,
      "reviewer-concentration",
      "B2_GROUNDED",
    );
    const b3 = await evaluate(
      instance,
      "reviewer-concentration",
      "B3_REPUGATE",
    );

    expect(b2.body.evaluation.decision).toBe("ALLOW");
    expect(b2.body.grant).not.toBeNull();
    expect(b3.body.evaluation.decision).toBe("BLOCK");
    expect(b3.body.grant).toBeNull();
  });

  it("makes evaluation retries idempotent and rejects key reuse", async () => {
    const instance = createApp();
    const service = await getService(instance, "honest-service");
    const payload = {
      buyer: BUYER,
      model: "B3_REPUGATE",
      scenarioId: service.id,
      offer: service.offer,
      expectedOfferHash: service.expectedOfferHash,
      idempotencyKey: "same-evaluation-request",
      tag2: "inference",
    };

    const first = await instance.inject({
      method: "POST",
      url: "/api/evaluations",
      payload,
    });
    const retry = await instance.inject({
      method: "POST",
      url: "/api/evaluations",
      payload,
    });
    const reused = await instance.inject({
      method: "POST",
      url: "/api/evaluations",
      payload: { ...payload, model: "B1_RAW" },
    });

    expect(first.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("maps invalid offer invariants to a stable API error", async () => {
    const instance = createApp();
    const service = await getService(instance, "honest-service");
    const response = await instance.inject({
      method: "POST",
      url: "/api/evaluations",
      payload: {
        buyer: BUYER,
        model: "B3_REPUGATE",
        scenarioId: service.id,
        offer: {
          ...service.offer,
          network: "eip155:1",
        },
        expectedOfferHash: service.expectedOfferHash,
        idempotencyKey: "invalid-offer-request",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "UNSUPPORTED_OFFER" });
  });

  it("consumes a grant once and returns an exact payment intent", async () => {
    const instance = createApp();
    const { body } = await evaluate(instance);
    const grant = body.grant!;
    const payload = consumptionPayload(grant);

    const first = await instance.inject({
      method: "POST",
      url: `/api/grants/${grant.id}/consume`,
      payload,
    });
    const retry = await instance.inject({
      method: "POST",
      url: `/api/grants/${grant.id}/consume`,
      payload,
    });
    const secondConsumption = await instance.inject({
      method: "POST",
      url: `/api/grants/${grant.id}/consume`,
      payload: { ...payload, idempotencyKey: "consume-request-2" },
    });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json()).toEqual(first.json());
    expect((first.json() as PaymentDto).authorizedIntent.offer.amount).toBe(
      "10000",
    );
    expect(secondConsumption.statusCode).toBe(409);
    expect(secondConsumption.json()).toMatchObject({
      code: "GRANT_ALREADY_CONSUMED",
    });
  });

  it("allows at most one concurrent grant consumption", async () => {
    const instance = createApp();
    const { body } = await evaluate(instance);
    const grant = body.grant!;
    const payload = consumptionPayload(grant);

    const results = await Promise.all([
      instance.inject({
        method: "POST",
        url: `/api/grants/${grant.id}/consume`,
        payload: { ...payload, idempotencyKey: "concurrent-request-a" },
      }),
      instance.inject({
        method: "POST",
        url: `/api/grants/${grant.id}/consume`,
        payload: { ...payload, idempotencyKey: "concurrent-request-b" },
      }),
    ]);

    expect(results.map((result) => result.statusCode).sort()).toEqual([
      201, 409,
    ]);
  });

  it.each([
    [
      "buyer",
      { buyer: "0xcccccccccccccccccccccccccccccccccccccccc" },
      "GRANT_BUYER_MISMATCH",
    ],
    [
      "offer hash",
      { offerHash: `0x${"11".repeat(32)}` },
      "GRANT_OFFER_MISMATCH",
    ],
    [
      "identity epoch",
      { identityEpoch: `0x${"22".repeat(32)}` },
      "GRANT_IDENTITY_MISMATCH",
    ],
    [
      "policy hash",
      { policyHash: `0x${"33".repeat(32)}` },
      "GRANT_POLICY_MISMATCH",
    ],
  ])(
    "rolls back a %s mismatch so the valid request can still consume",
    async (_label, override, expectedCode) => {
      const instance = createApp();
      const { body } = await evaluate(instance);
      const grant = body.grant!;
      const payload = consumptionPayload(grant);

      const mismatch = await instance.inject({
        method: "POST",
        url: `/api/grants/${grant.id}/consume`,
        payload: {
          ...payload,
          ...override,
        },
      });
      const valid = await instance.inject({
        method: "POST",
        url: `/api/grants/${grant.id}/consume`,
        payload,
      });

      expect(mismatch.statusCode).toBe(409);
      expect(mismatch.json()).toMatchObject({ code: expectedCode });
      expect(valid.statusCode).toBe(201);
    },
  );

  it("rejects an expired grant", async () => {
    const instance = createApp();
    const { body } = await evaluate(instance);
    const grant = body.grant!;
    now = grant.expiresAt;

    const response = await instance.inject({
      method: "POST",
      url: `/api/grants/${grant.id}/consume`,
      payload: consumptionPayload(grant),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "GRANT_EXPIRED" });
  });

  it("applies client payment events but refuses client-verified settlement", async () => {
    const instance = createApp();
    const { body } = await evaluate(instance);
    const grant = body.grant!;
    const consumed = await instance.inject({
      method: "POST",
      url: `/api/grants/${grant.id}/consume`,
      payload: consumptionPayload(grant),
    });
    const paymentId = (consumed.json() as PaymentDto).payment.paymentId;

    for (const [offset, payload] of [
      {
        eventType: "WALLET_AUTHORIZED",
        idempotencyKey: "payment-event-1",
      },
      {
        eventType: "PAYMENT_SUBMITTED",
        idempotencyKey: "payment-event-2",
      },
      {
        eventType: "SETTLEMENT_RECEIVED",
        idempotencyKey: "payment-event-3",
        transactionHash: `0x${"aa".repeat(32)}`,
      },
    ].entries()) {
      now += offset + 1;
      const response = await instance.inject({
        method: "POST",
        url: `/api/payments/${paymentId}/events`,
        payload,
      });
      expect(response.statusCode).toBe(200);
    }

    const payment = await instance.inject({
      method: "GET",
      url: `/api/payments/${paymentId}`,
    });
    const forbiddenSettlement = await instance.inject({
      method: "POST",
      url: `/api/payments/${paymentId}/events`,
      payload: {
        eventType: "SETTLEMENT_VERIFIED",
        idempotencyKey: "payment-event-4",
        transactionHash: `0x${"aa".repeat(32)}`,
      },
    });

    expect((payment.json() as PaymentDto).payment.state).toBe(
      "SETTLEMENT_PENDING",
    );
    expect(forbiddenSettlement.statusCode).toBe(400);
    expect(forbiddenSettlement.json()).toMatchObject({
      code: "INVALID_REQUEST",
    });

    const clientFailure = await instance.inject({
      method: "POST",
      url: `/api/payments/${paymentId}/events`,
      payload: {
        eventType: "PAYMENT_FAILED",
        idempotencyKey: "payment-event-5",
        failureCode: "RPC_TIMEOUT",
      },
    });
    expect(clientFailure.statusCode).toBe(409);
    expect(clientFailure.json()).toMatchObject({
      code: "SETTLEMENT_RECONCILIATION_REQUIRED",
    });
  });

  it("makes payment-event retries idempotent and rejects key reuse", async () => {
    const instance = createApp();
    const { body } = await evaluate(instance);
    const grant = body.grant!;
    const consumed = await instance.inject({
      method: "POST",
      url: `/api/grants/${grant.id}/consume`,
      payload: consumptionPayload(grant),
    });
    const paymentId = (consumed.json() as PaymentDto).payment.paymentId;
    const event = {
      eventType: "WALLET_AUTHORIZED",
      idempotencyKey: "idempotent-event-1",
    };

    const first = await instance.inject({
      method: "POST",
      url: `/api/payments/${paymentId}/events`,
      payload: event,
    });
    const retry = await instance.inject({
      method: "POST",
      url: `/api/payments/${paymentId}/events`,
      payload: event,
    });
    const reused = await instance.inject({
      method: "POST",
      url: `/api/payments/${paymentId}/events`,
      payload: {
        eventType: "PAYMENT_SUBMITTED",
        idempotencyKey: event.idempotencyKey,
      },
    });

    expect(first.statusCode).toBe(200);
    expect(retry.json()).toEqual(first.json());
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });
});
