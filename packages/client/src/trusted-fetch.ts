import type {
  Address,
  Bytes32,
  CanonicalOfferInput,
  Decision,
  EvmNetwork,
  OfferEvaluationResult,
  ReputationModel,
} from "@repugate/core";
import {
  bytes32Schema,
  canonicalizeHttpUrl,
  canonicalizeOffer,
  evmAddressSchema,
  hashRequestBody,
} from "@repugate/core";
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
} from "@repugate/x402";

import { TrustedFetchError } from "./errors";
import { GuardedPaymentClient } from "./guarded-payment-client";
import {
  selectExactEvmOffer,
  type PaymentSelectionPolicy,
} from "./offer-selector";
import type {
  EvaluationApiPort,
  FetchPort,
  IdempotencyKeyGenerator,
  WalletPort,
} from "./ports";
import { decodeX402Header, encodeX402Header } from "./x402/codec";
import {
  paymentRequiredSchema,
  repugateAgentInfoSchema,
  settlementResponseSchema,
  type PaymentPayload,
  type PaymentRequired,
  type SettlementResponse,
} from "./x402/schemas";

export {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
};

export type TrustedRequestBody = string | Uint8Array;

export type TrustedRequestInit = Omit<RequestInit, "body" | "redirect"> & {
  body?: TrustedRequestBody | null;
};

export interface TrustEvaluationConfig {
  model: ReputationModel;
  scenarioId: string;
  expectedOfferHash?: Bytes32;
  tag1?: string;
  tag2?: string;
}

export interface TrustedFetchOptions {
  payment: PaymentSelectionPolicy;
  evaluation: TrustEvaluationConfig;
}

export interface TrustedFetchDependencies {
  fetchPort: FetchPort;
  evaluationApi: EvaluationApiPort;
  wallet: WalletPort;
  idempotencyKeys: IdempotencyKeyGenerator;
}

export type TrustedFetchStage =
  | "EVALUATED"
  | "GRANT_CONSUMED"
  | "INITIAL_REQUEST"
  | "OFFER_SELECTED"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_SUBMITTED"
  | "SETTLEMENT_REPORTED"
  | "WALLET_AUTHORIZED";

interface ResultBase {
  response: Response;
  stages: readonly TrustedFetchStage[];
}

export type TrustedFetchResult =
  | (ResultBase & { kind: "FREE" })
  | (ResultBase & {
      kind: "DENIED";
      decision: Exclude<Decision, "ALLOW">;
      evaluation: OfferEvaluationResult;
    })
  | (ResultBase & {
      kind: "PAID";
      paymentId: string;
      settlement: "PENDING" | "UNREPORTED";
      transactionHash?: Bytes32;
    })
  | (ResultBase & {
      kind: "PAYMENT_FAILED";
      paymentId: string;
      reason: string;
    });

function isRedirect(response: Response): boolean {
  return (
    response.type === "opaqueredirect" ||
    (response.status >= 300 && response.status < 400)
  );
}

function assertNoRedirect(response: Response): void {
  if (isRedirect(response)) {
    throw new TrustedFetchError(
      "REDIRECT_BLOCKED",
      "Redirects are disabled during a guarded payment flow",
    );
  }
}

function cloneBody(body: TrustedRequestBody | null | undefined): BodyInit | null {
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    return body.slice();
  }

  throw new TrustedFetchError(
    "UNSUPPORTED_REQUEST_BODY",
    "Guarded requests support only string or Uint8Array bodies so they can be hashed and replayed exactly",
  );
}

function snapshotRequestInit(input: TrustedRequestInit): TrustedRequestInit {
  const body = input.body;

  return {
    ...input,
    headers: new Headers(input.headers),
    ...(body === undefined
      ? {}
      : { body: body instanceof Uint8Array ? body.slice() : body }),
  };
}

function buildRequestInit(
  input: TrustedRequestInit,
  paymentSignature?: string,
): RequestInit {
  const headers = new Headers(input.headers);
  headers.delete(PAYMENT_SIGNATURE_HEADER);
  if (paymentSignature !== undefined) {
    headers.set(PAYMENT_SIGNATURE_HEADER, paymentSignature);
  }

  return {
    ...input,
    body: cloneBody(input.body),
    headers,
    redirect: "manual",
  };
}

function readPaymentRequired(response: Response): PaymentRequired {
  const header = response.headers.get(PAYMENT_REQUIRED_HEADER);
  if (header === null) {
    throw new TrustedFetchError(
      "MISSING_PAYMENT_REQUIRED",
      "The provider returned HTTP 402 without a PAYMENT-REQUIRED header",
    );
  }

  return decodeX402Header(
    header,
    paymentRequiredSchema,
    "INVALID_PAYMENT_REQUIRED",
  );
}

function assertResourceMatchesRequest(
  requestedUrl: string,
  paymentRequired: PaymentRequired,
): void {
  if (
    canonicalizeHttpUrl(paymentRequired.resource.url) !==
    canonicalizeHttpUrl(requestedUrl)
  ) {
    throw new TrustedFetchError(
      "RESOURCE_MISMATCH",
      "The x402 PaymentRequired resource does not match the requested URL",
    );
  }
}

function readAgentInfo(paymentRequired: PaymentRequired) {
  const extension = paymentRequired.extensions?.["repugate-agent"];
  const parsed = repugateAgentInfoSchema.safeParse(extension?.info);
  if (!parsed.success) {
    throw new TrustedFetchError(
      "MISSING_AGENT_EXTENSION",
      "The controlled provider must supply agentRegistry, agentId, and endpointHash in its experimental repugate-agent extension",
      { cause: parsed.error },
    );
  }

  return parsed.data;
}

function chainIdFromNetwork(network: EvmNetwork): number {
  const chainId = Number(network.slice("eip155:".length));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new TrustedFetchError(
      "INVALID_PAYMENT_REQUIRED",
      "The selected EVM network has an unsupported chain identifier",
    );
  }

  return chainId;
}

function bodyForHash(body: TrustedRequestBody | null | undefined) {
  return body ?? undefined;
}

function offerToInput(input: {
  requestedUrl: string;
  request: TrustedRequestInit;
  selected: ReturnType<typeof selectExactEvmOffer>;
  agent: ReturnType<typeof readAgentInfo>;
}): CanonicalOfferInput {
  const method = input.request.method ?? "GET";
  const network = input.selected.network as EvmNetwork;

  return {
    method,
    resourceUrl: input.requestedUrl,
    endpointHash: input.agent.endpointHash,
    requestBodyHash: hashRequestBody(bodyForHash(input.request.body)),
    scheme: "exact",
    network,
    asset: input.selected.asset,
    amount: input.selected.amount,
    payTo: input.selected.payTo,
    maxTimeoutSeconds: input.selected.maxTimeoutSeconds,
    agent: {
      chainId: chainIdFromNetwork(network),
      registry: input.agent.agentRegistry,
      agentId: input.agent.agentId,
    },
  };
}

function validateSettlement(
  settlement: SettlementResponse,
  input: { network: string; buyer: Address; amount: string },
): Bytes32 | null {
  if (settlement.network !== input.network) {
    throw new TrustedFetchError(
      "INVALID_SETTLEMENT_RESPONSE",
      "The settlement network does not match the selected offer",
    );
  }
  if (
    settlement.payer !== undefined &&
    settlement.payer.toLowerCase() !== input.buyer.toLowerCase()
  ) {
    throw new TrustedFetchError(
      "INVALID_SETTLEMENT_RESPONSE",
      "The settlement payer does not match the wallet that authorized payment",
    );
  }
  if (settlement.amount !== undefined && settlement.amount !== input.amount) {
    throw new TrustedFetchError(
      "INVALID_SETTLEMENT_RESPONSE",
      "The settlement amount does not match the selected offer",
    );
  }

  const shouldHaveTransaction =
    settlement.success || settlement.errorReason === "settlement_pending";
  if (!shouldHaveTransaction) {
    return null;
  }

  const transaction = bytes32Schema.safeParse(settlement.transaction);
  if (!transaction.success) {
    throw new TrustedFetchError(
      "INVALID_SETTLEMENT_RESPONSE",
      "A successful or pending EVM settlement must include a transaction hash",
      { cause: transaction.error },
    );
  }

  return transaction.data as Bytes32;
}

async function markFailurePreservingError(
  client: GuardedPaymentClient,
  paymentId: string,
  failureCode: string,
): Promise<void> {
  try {
    await client.markFailed(paymentId, failureCode);
  } catch {
    // The original provider/security outcome is more useful than telemetry failure.
  }
}

export async function trustedFetch(
  input: string | URL,
  init: TrustedRequestInit,
  options: TrustedFetchOptions,
  dependencies: TrustedFetchDependencies,
): Promise<TrustedFetchResult> {
  const requestedUrl = input.toString();
  const request = snapshotRequestInit(init);
  const stages: TrustedFetchStage[] = ["INITIAL_REQUEST"];
  const initialResponse = await dependencies.fetchPort.fetch(
    requestedUrl,
    buildRequestInit(request),
  );
  assertNoRedirect(initialResponse);

  if (initialResponse.status !== 402) {
    return { kind: "FREE", response: initialResponse, stages };
  }

  stages.push("PAYMENT_REQUIRED");
  const paymentRequired = readPaymentRequired(initialResponse);
  assertResourceMatchesRequest(requestedUrl, paymentRequired);
  const selected = selectExactEvmOffer(
    paymentRequired.accepts,
    options.payment,
  );
  const agent = readAgentInfo(paymentRequired);
  const offerInput = offerToInput({
    requestedUrl,
    request,
    selected,
    agent,
  });
  const localOffer = canonicalizeOffer(offerInput);
  stages.push("OFFER_SELECTED");

  let buyer: Address;
  try {
    buyer = evmAddressSchema.parse(
      await dependencies.wallet.getAddress(),
    ) as Address;
  } catch (error) {
    throw new TrustedFetchError(
      "WALLET_AUTHORIZATION_INVALID",
      "The wallet did not return a valid EVM buyer address",
      { cause: error },
    );
  }

  const evaluation = await dependencies.evaluationApi.evaluateOffer({
    buyer,
    model: options.evaluation.model,
    scenarioId: options.evaluation.scenarioId,
    offer: offerInput,
    expectedOfferHash:
      options.evaluation.expectedOfferHash === undefined
        ? localOffer.offerHash
        : (bytes32Schema.parse(options.evaluation.expectedOfferHash) as Bytes32),
    idempotencyKey: dependencies.idempotencyKeys.next("evaluate"),
    ...(options.evaluation.tag1 === undefined
      ? {}
      : { tag1: options.evaluation.tag1 }),
    ...(options.evaluation.tag2 === undefined
      ? {}
      : { tag2: options.evaluation.tag2 }),
  });
  stages.push("EVALUATED");

  if (
    evaluation.evaluation.decision === "BLOCK" ||
    evaluation.evaluation.decision === "REVIEW"
  ) {
    return {
      kind: "DENIED",
      response: initialResponse,
      decision: evaluation.evaluation.decision,
      evaluation: evaluation.evaluation,
      stages,
    };
  }

  const guardedClient = new GuardedPaymentClient(
    dependencies.evaluationApi,
    dependencies.wallet,
    dependencies.idempotencyKeys,
  );
  const prepared = await guardedClient.prepare({
    buyer,
    localOffer,
    evaluation,
  });
  stages.push("GRANT_CONSUMED", "WALLET_AUTHORIZED");

  const paymentPayload: PaymentPayload = {
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted: selected,
    payload: prepared.signedAuthorization,
    ...(paymentRequired.extensions === undefined
      ? {}
      : { extensions: paymentRequired.extensions }),
  };

  await guardedClient.markSubmitted(prepared.paymentId);
  stages.push("PAYMENT_SUBMITTED");
  let paidResponse: Response;
  try {
    paidResponse = await dependencies.fetchPort.fetch(
      requestedUrl,
      buildRequestInit(request, encodeX402Header(paymentPayload)),
    );
  } catch (error) {
    throw new TrustedFetchError(
      "PAYMENT_SUBMISSION_UNCERTAIN",
      `Payment ${prepared.paymentId} was submitted but no provider response was received; reconcile it before retrying`,
      { cause: error },
    );
  }
  if (isRedirect(paidResponse)) {
    await markFailurePreservingError(
      guardedClient,
      prepared.paymentId,
      "REDIRECT_BLOCKED",
    );
    assertNoRedirect(paidResponse);
  }

  if (paidResponse.status === 402) {
    await markFailurePreservingError(
      guardedClient,
      prepared.paymentId,
      "PAYMENT_REJECTED",
    );
    return {
      kind: "PAYMENT_FAILED",
      response: paidResponse,
      paymentId: prepared.paymentId,
      reason: "PAYMENT_REJECTED",
      stages,
    };
  }

  const settlementHeader = paidResponse.headers.get(PAYMENT_RESPONSE_HEADER);
  if (settlementHeader === null) {
    if (!paidResponse.ok) {
      const reason = `PROVIDER_HTTP_${paidResponse.status}`;
      await markFailurePreservingError(
        guardedClient,
        prepared.paymentId,
        reason,
      );
      return {
        kind: "PAYMENT_FAILED",
        response: paidResponse,
        paymentId: prepared.paymentId,
        reason,
        stages,
      };
    }

    return {
      kind: "PAID",
      response: paidResponse,
      paymentId: prepared.paymentId,
      settlement: "UNREPORTED",
      stages,
    };
  }

  const settlement = decodeX402Header(
    settlementHeader,
    settlementResponseSchema,
    "INVALID_SETTLEMENT_RESPONSE",
  );
  const transactionHash = validateSettlement(settlement, {
    network: selected.network,
    buyer,
    amount: selected.amount,
  });
  if (transactionHash === null) {
    const reason = settlement.errorReason ?? "SETTLEMENT_FAILED";
    await markFailurePreservingError(
      guardedClient,
      prepared.paymentId,
      reason,
    );
    return {
      kind: "PAYMENT_FAILED",
      response: paidResponse,
      paymentId: prepared.paymentId,
      reason,
      stages,
    };
  }

  await guardedClient.markSettlementReceived(
    prepared.paymentId,
    transactionHash,
  );
  stages.push("SETTLEMENT_REPORTED");
  return {
    kind: "PAID",
    response: paidResponse,
    paymentId: prepared.paymentId,
    settlement: "PENDING",
    transactionHash,
    stages,
  };
}
