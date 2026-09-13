import { describe, expect, it } from "vitest";
import { z } from "zod";

import type {
  Address,
  AuthorizedPaymentIntent,
  EvaluationGrant,
  PaymentAttempt,
  PaymentEvent,
  ReputationModel,
} from "@repugate/core";
import {
  assertGrantConsumable,
  canonicalizeOffer,
  createDeterministicScenario,
  createPaymentAttempt,
  evaluateOffer,
  hashRequestBody,
  issueEvaluationGrant,
  reducePaymentEvent,
} from "@repugate/core";
import type { DeterministicScenarioId } from "@repugate/core";

import { TrustedFetchError } from "./errors";
import type {
  ClientPaymentEventRequest,
  ConsumeGrantRequest,
  EvaluationApiPort,
  EvaluationRequest,
  EvaluationResponse,
  FetchPort,
  IdempotencyKeyGenerator,
  PaymentResponse,
  WalletPort,
} from "./ports";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  trustedFetch,
  type TrustedFetchOptions,
} from "./trusted-fetch";
import { decodeX402Header, encodeX402Header } from "./x402/codec";
import type {
  PaymentPayload,
  PaymentRequired,
  SignedEvmAuthorization,
} from "./x402/schemas";

const BUYER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;
const TRANSACTION_HASH = `0x${"ab".repeat(32)}` as const;
const SIGNATURE = `0x${"cd".repeat(65)}` as const;
const NONCE = `0x${"ef".repeat(32)}` as const;
const BODY = '{"prompt":"hello"}';

type FetchStep = Response | Error | ((init: RequestInit) => Response);

class FakeFetch implements FetchPort {
  readonly calls: Array<{ input: string; init: RequestInit }> = [];

  constructor(private readonly steps: FetchStep[]) {}

  async fetch(input: string, init: RequestInit): Promise<Response> {
    this.calls.push({ input, init });
    const step = this.steps.shift();
    if (step === undefined) {
      throw new Error("Unexpected fetch call");
    }
    if (step instanceof Error) {
      throw step;
    }

    return typeof step === "function" ? step(init) : step;
  }
}

class SequentialKeys implements IdempotencyKeyGenerator {
  private sequence = 0;

  next(scope: "consume" | "evaluate" | "payment-event"): string {
    this.sequence += 1;
    return `${scope}-test-key-${this.sequence}`;
  }
}

class FakeWallet implements WalletPort {
  getAddressCalls = 0;
  getChainIdCalls = 0;
  signCalls = 0;

  constructor(
    readonly address = BUYER,
    public chainId = 84_532,
    private readonly mutate?: (
      authorization: SignedEvmAuthorization,
    ) => SignedEvmAuthorization,
  ) {}

  async getAddress(): Promise<Address> {
    this.getAddressCalls += 1;
    return this.address;
  }

  async getChainId(): Promise<number> {
    this.getChainIdCalls += 1;
    return this.chainId;
  }

  async signX402Authorization(
    intent: AuthorizedPaymentIntent,
  ): Promise<SignedEvmAuthorization> {
    this.signCalls += 1;
    const authorization: SignedEvmAuthorization = {
      signature: SIGNATURE,
      authorization: {
        from: intent.buyer,
        to: intent.offer.payTo,
        value: intent.offer.amount.toString(),
        validAfter: "1700000000",
        validBefore: "1700000060",
        nonce: NONCE,
      },
    };

    return this.mutate?.(authorization) ?? authorization;
  }
}

class FakeEvaluationApi implements EvaluationApiPort {
  readonly evaluationRequests: EvaluationRequest[] = [];
  readonly consumeRequests: ConsumeGrantRequest[] = [];
  readonly events: ClientPaymentEventRequest[] = [];
  grant: EvaluationGrant | null = null;
  payment: PaymentAttempt | null = null;

  private evaluationResponse: EvaluationResponse | null = null;
  private intent: AuthorizedPaymentIntent | null = null;
  private now = 1_700_000_000;

  constructor(
    private readonly mutateIntent?: (
      intent: AuthorizedPaymentIntent,
    ) => AuthorizedPaymentIntent,
  ) {}

  async evaluateOffer(request: EvaluationRequest): Promise<EvaluationResponse> {
    this.evaluationRequests.push(request);
    const scenario = createDeterministicScenario(
      request.scenarioId as DeterministicScenarioId,
      request.model,
    );
    const evaluation = await evaluateOffer(
      {
        offer: request.offer,
        model: request.model,
        expectedOfferHash: request.expectedOfferHash,
        ...(request.tag1 === undefined ? {} : { tag1: request.tag1 }),
        ...(request.tag2 === undefined ? {} : { tag2: request.tag2 }),
      },
      scenario.ports,
    );
    const decisionId = "decision-test-1";
    this.grant =
      evaluation.decision === "ALLOW"
        ? issueEvaluationGrant({
            id: "grant-test-1",
            decisionId,
            buyer: request.buyer,
            evaluation,
            issuedAt: this.now,
            lifetimeSeconds: 300,
          })
        : null;
    this.evaluationResponse = { decisionId, evaluation, grant: this.grant };

    return this.evaluationResponse;
  }

  async consumeGrant(request: ConsumeGrantRequest): Promise<PaymentResponse> {
    this.consumeRequests.push(request);
    if (this.grant === null || this.evaluationResponse === null) {
      throw new Error("No grant is available");
    }
    assertGrantConsumable(this.grant, request, this.now);
    this.grant = { ...this.grant, status: "CONSUMED" };
    this.payment = createPaymentAttempt({
      paymentId: "payment-test-1",
      grantId: this.grant.id,
      createdAt: this.now,
    });
    const baseIntent: AuthorizedPaymentIntent = {
      paymentId: this.payment.paymentId,
      grantId: this.grant.id,
      buyer: this.grant.buyer,
      offerHash: this.grant.offerHash,
      identityEpoch: this.grant.identityEpoch,
      policyHash: this.grant.policyHash,
      offer: this.evaluationResponse.evaluation.canonicalOffer,
    };
    this.intent = this.mutateIntent?.(baseIntent) ?? baseIntent;

    return { payment: this.payment, authorizedIntent: this.intent };
  }

  async recordPaymentEvent(
    paymentId: string,
    event: ClientPaymentEventRequest,
  ): Promise<PaymentResponse> {
    this.events.push(event);
    if (
      this.payment === null ||
      this.intent === null ||
      this.payment.paymentId !== paymentId
    ) {
      throw new Error("No payment is available");
    }
    this.now += 1;

    let domainEvent: PaymentEvent;
    switch (event.eventType) {
      case "WALLET_AUTHORIZED":
        domainEvent = { type: event.eventType, occurredAt: this.now };
        break;
      case "PAYMENT_SUBMITTED":
        domainEvent = { type: event.eventType, occurredAt: this.now };
        break;
      case "SETTLEMENT_RECEIVED":
        domainEvent = {
          type: event.eventType,
          occurredAt: this.now,
          transactionHash: event.transactionHash,
        };
        break;
      case "PAYMENT_FAILED":
        domainEvent = {
          type: event.eventType,
          occurredAt: this.now,
          failureCode: event.failureCode,
        };
        break;
    }
    this.payment = reducePaymentEvent(this.payment, domainEvent);

    return { payment: this.payment, authorizedIntent: this.intent };
  }
}

class MissingGrantApi extends FakeEvaluationApi {
  override async evaluateOffer(
    request: EvaluationRequest,
  ): Promise<EvaluationResponse> {
    const response = await super.evaluateOffer(request);

    return { ...response, grant: null };
  }
}

function paymentRequired(
  scenarioId: DeterministicScenarioId,
  overrides: Partial<PaymentRequired> = {},
): PaymentRequired {
  const scenario = createDeterministicScenario(scenarioId, "B3_REPUGATE");
  const canonical = canonicalizeOffer(scenario.input.offer).offer;

  return {
    x402Version: 2,
    resource: { url: canonical.resourceUrl, description: "Demo inference" },
    accepts: [
      {
        scheme: canonical.scheme,
        network: canonical.network,
        amount: canonical.amount.toString(),
        asset: canonical.asset,
        payTo: canonical.payTo,
        maxTimeoutSeconds: canonical.maxTimeoutSeconds,
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
          agentRegistry: canonical.agent.registry,
          agentId: canonical.agent.agentId.toString(),
          endpointHash: canonical.endpointHash,
        },
        schema: { type: "object" },
      },
    },
    ...overrides,
  };
}

function requiredResponse(required: PaymentRequired): Response {
  return new Response("payment required", {
    status: 402,
    headers: { [PAYMENT_REQUIRED_HEADER]: encodeX402Header(required) },
  });
}

function settledResponse(required: PaymentRequired): Response {
  return new Response('{"result":"ok"}', {
    status: 200,
    headers: {
      "content-type": "application/json",
      [PAYMENT_RESPONSE_HEADER]: encodeX402Header({
        success: true,
        payer: BUYER,
        transaction: TRANSACTION_HASH,
        network: required.accepts[0]!.network,
        amount: required.accepts[0]!.amount,
      }),
    },
  });
}

function options(
  required: PaymentRequired,
  scenarioId: DeterministicScenarioId,
  model: ReputationModel = "B3_REPUGATE",
): TrustedFetchOptions {
  const selected = required.accepts[0]!;

  return {
    payment: {
      network: selected.network as `eip155:${number}`,
      asset: selected.asset as Address,
      maxAmount: 20_000n,
      maxTimeoutSeconds: 60,
    },
    evaluation: { model, scenarioId, tag2: "inference" },
  };
}

function dependencies(
  fetchPort: FakeFetch,
  evaluationApi = new FakeEvaluationApi(),
  wallet = new FakeWallet(),
) {
  return {
    fetchPort,
    evaluationApi,
    wallet,
    idempotencyKeys: new SequentialKeys(),
  };
}

describe("trustedFetch", () => {
  it("returns a free response without accessing any wallet capability", async () => {
    const fetchPort = new FakeFetch([new Response("free", { status: 200 })]);
    const wallet = new FakeWallet();
    const api = new FakeEvaluationApi();
    const required = paymentRequired("honest-service");

    const result = await trustedFetch(
      required.resource.url,
      { method: "POST", body: BODY },
      options(required, "honest-service"),
      dependencies(fetchPort, api, wallet),
    );

    expect(result.kind).toBe("FREE");
    expect(wallet.getAddressCalls).toBe(0);
    expect(wallet.getChainIdCalls).toBe(0);
    expect(wallet.signCalls).toBe(0);
    expect(api.evaluationRequests).toHaveLength(0);
  });

  it("runs the honest B3 flow once and echoes the exact x402 offer and extension", async () => {
    const required = paymentRequired("honest-service");
    const fetchPort = new FakeFetch([
      requiredResponse(required),
      settledResponse(required),
    ]);
    const wallet = new FakeWallet();
    const api = new FakeEvaluationApi();

    const result = await trustedFetch(
      required.resource.url,
      { method: "POST", body: BODY },
      options(required, "honest-service"),
      dependencies(fetchPort, api, wallet),
    );

    expect(result).toMatchObject({
      kind: "PAID",
      settlement: "PENDING",
      transactionHash: TRANSACTION_HASH,
    });
    expect(wallet.signCalls).toBe(1);
    expect(api.consumeRequests).toHaveLength(1);
    expect(api.payment?.state).toBe("SETTLEMENT_PENDING");
    expect(fetchPort.calls).toHaveLength(2);
    expect(
      new Headers(fetchPort.calls[0]!.init.headers).has(
        PAYMENT_SIGNATURE_HEADER,
      ),
    ).toBe(false);

    const signatureHeader = new Headers(
      fetchPort.calls[1]!.init.headers,
    ).get(PAYMENT_SIGNATURE_HEADER);
    expect(signatureHeader).not.toBeNull();
    const payload = decodeX402Header(
      signatureHeader!,
      z.unknown(),
      "INVALID_PAYMENT_REQUIRED",
    ) as PaymentPayload;
    expect(payload.accepted).toEqual(required.accepts[0]);
    expect(payload.extensions).toEqual(required.extensions);
    expect(payload.payload.authorization).toMatchObject({
      from: BUYER,
      to: required.accepts[0]!.payTo,
      value: required.accepts[0]!.amount,
    });
  });

  it("blocks ungrounded B3 reputation before Grant consumption or signing", async () => {
    const required = paymentRequired("ungrounded-feedback");
    const fetchPort = new FakeFetch([requiredResponse(required)]);
    const wallet = new FakeWallet();
    const api = new FakeEvaluationApi();

    const result = await trustedFetch(
      required.resource.url,
      { method: "POST", body: BODY },
      options(required, "ungrounded-feedback"),
      dependencies(fetchPort, api, wallet),
    );

    expect(result).toMatchObject({ kind: "DENIED", decision: "BLOCK" });
    expect(api.consumeRequests).toHaveLength(0);
    expect(wallet.signCalls).toBe(0);
    expect(fetchPort.calls).toHaveLength(1);
  });

  it("never signs when an API claims ALLOW but supplies no Grant", async () => {
    const required = paymentRequired("honest-service");
    const fetchPort = new FakeFetch([requiredResponse(required)]);
    const api = new MissingGrantApi();
    const wallet = new FakeWallet();

    await expect(
      trustedFetch(
        required.resource.url,
        { method: "POST", body: BODY },
        options(required, "honest-service"),
        dependencies(fetchPort, api, wallet),
      ),
    ).rejects.toMatchObject<Partial<TrustedFetchError>>({
      code: "EVALUATION_BINDING_MISMATCH",
    });
    expect(api.consumeRequests).toHaveLength(0);
    expect(wallet.signCalls).toBe(0);
  });

  it("shows why raw B1 is an unsafe baseline by allowing the same ungrounded ratings", async () => {
    const required = paymentRequired("ungrounded-feedback");
    const fetchPort = new FakeFetch([
      requiredResponse(required),
      settledResponse(required),
    ]);
    const wallet = new FakeWallet();

    const result = await trustedFetch(
      required.resource.url,
      { method: "POST", body: BODY },
      options(required, "ungrounded-feedback", "B1_RAW"),
      dependencies(fetchPort, new FakeEvaluationApi(), wallet),
    );

    expect(result.kind).toBe("PAID");
    expect(wallet.signCalls).toBe(1);
  });

  it("rejects a tampered API intent before the wallet can sign", async () => {
    const required = paymentRequired("honest-service");
    const fetchPort = new FakeFetch([requiredResponse(required)]);
    const api = new FakeEvaluationApi((intent) => ({
      ...intent,
      offer: { ...intent.offer, amount: intent.offer.amount + 1n },
    }));
    const wallet = new FakeWallet();

    await expect(
      trustedFetch(
        required.resource.url,
        { method: "POST", body: BODY },
        options(required, "honest-service"),
        dependencies(fetchPort, api, wallet),
      ),
    ).rejects.toMatchObject<Partial<TrustedFetchError>>({
      code: "AUTHORIZED_INTENT_MISMATCH",
    });
    expect(wallet.signCalls).toBe(0);
    expect(fetchPort.calls).toHaveLength(1);
  });

  it("rejects a wrong wallet chain before signing and marks the attempt failed", async () => {
    const required = paymentRequired("honest-service");
    const fetchPort = new FakeFetch([requiredResponse(required)]);
    const api = new FakeEvaluationApi();
    const wallet = new FakeWallet(BUYER, 1);

    await expect(
      trustedFetch(
        required.resource.url,
        { method: "POST", body: BODY },
        options(required, "honest-service"),
        dependencies(fetchPort, api, wallet),
      ),
    ).rejects.toMatchObject<Partial<TrustedFetchError>>({
      code: "WALLET_CHAIN_MISMATCH",
    });
    expect(wallet.signCalls).toBe(0);
    expect(api.payment?.state).toBe("FAILED");
  });

  it.each([
    ["over-budget", { amount: "20001" }],
    ["upfront", { extra: { paymentFlow: "upfront" } }],
  ])("rejects an %s offer before evaluation or wallet access", async (_label, override) => {
    const base = paymentRequired("honest-service");
    const required = {
      ...base,
      accepts: [{ ...base.accepts[0]!, ...override }],
    };
    const fetchPort = new FakeFetch([requiredResponse(required)]);
    const api = new FakeEvaluationApi();
    const wallet = new FakeWallet();

    await expect(
      trustedFetch(
        required.resource.url,
        { method: "POST", body: BODY },
        options(base, "honest-service"),
        dependencies(fetchPort, api, wallet),
      ),
    ).rejects.toMatchObject<Partial<TrustedFetchError>>({
      code: "NO_ACCEPTABLE_OFFER",
    });
    expect(api.evaluationRequests).toHaveLength(0);
    expect(wallet.getAddressCalls).toBe(0);
    expect(wallet.signCalls).toBe(0);
  });

  it("blocks redirects before evaluation and wallet access", async () => {
    const required = paymentRequired("honest-service");
    const fetchPort = new FakeFetch([
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/collect" },
      }),
    ]);
    const api = new FakeEvaluationApi();
    const wallet = new FakeWallet();

    await expect(
      trustedFetch(
        required.resource.url,
        { method: "POST", body: BODY },
        options(required, "honest-service"),
        dependencies(fetchPort, api, wallet),
      ),
    ).rejects.toMatchObject<Partial<TrustedFetchError>>({
      code: "REDIRECT_BLOCKED",
    });
    expect(api.evaluationRequests).toHaveLength(0);
    expect(wallet.getAddressCalls).toBe(0);
  });

  it("does not create a second authorization after a post-submission network error", async () => {
    const required = paymentRequired("honest-service");
    const fetchPort = new FakeFetch([
      requiredResponse(required),
      new Error("network offline after submit"),
    ]);
    const api = new FakeEvaluationApi();
    const wallet = new FakeWallet();

    await expect(
      trustedFetch(
        required.resource.url,
        { method: "POST", body: BODY },
        options(required, "honest-service"),
        dependencies(fetchPort, api, wallet),
      ),
    ).rejects.toMatchObject<Partial<TrustedFetchError>>({
      code: "PAYMENT_SUBMISSION_UNCERTAIN",
      cause: expect.objectContaining({
        message: "network offline after submit",
      }),
    });
    expect(wallet.signCalls).toBe(1);
    expect(api.consumeRequests).toHaveLength(1);
    expect(api.payment?.state).toBe("SUBMITTED");
  });

  it("snapshots mutable request bytes before any asynchronous wallet work", async () => {
    const required = paymentRequired("honest-service");
    const mutableBody = new TextEncoder().encode(BODY);
    const originalBody = mutableBody.slice();
    const api = new FakeEvaluationApi();
    const fetchPort = new FakeFetch([
      () => {
        mutableBody.fill(0);
        return requiredResponse(required);
      },
      (init) => {
        expect(Array.from(init.body as Uint8Array)).toEqual(
          Array.from(originalBody),
        );
        return settledResponse(required);
      },
    ]);

    const result = await trustedFetch(
      required.resource.url,
      { method: "POST", body: mutableBody },
      options(required, "honest-service"),
      dependencies(fetchPort, api),
    );

    expect(result.kind).toBe("PAID");
    expect(api.evaluationRequests[0]?.offer.requestBodyHash).toBe(
      hashRequestBody(originalBody),
    );
  });

  it("rejects a resource-substitution header before wallet access", async () => {
    const base = paymentRequired("honest-service");
    const required = {
      ...base,
      resource: { ...base.resource, url: "https://attacker.example/pay" },
    };
    const fetchPort = new FakeFetch([requiredResponse(required)]);
    const wallet = new FakeWallet();

    await expect(
      trustedFetch(
        base.resource.url,
        { method: "POST", body: BODY },
        options(base, "honest-service"),
        dependencies(fetchPort, new FakeEvaluationApi(), wallet),
      ),
    ).rejects.toMatchObject<Partial<TrustedFetchError>>({
      code: "RESOURCE_MISMATCH",
    });
    expect(wallet.getAddressCalls).toBe(0);
  });
});
