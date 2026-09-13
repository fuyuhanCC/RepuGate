import type {
  ClientPaymentEventRequest,
  ConsumeGrantRequest,
  EvaluationApiPort,
  EvaluationRequest,
  EvaluationResponse,
  PaymentResponse,
} from "@repugate/client";

import {
  liveRegistryResponseSchema,
  parseEvaluationResponse,
  parsePaymentResponse,
  serviceCatalogSchema,
  type ServiceCatalogItem,
  type LiveRegistryResponse,
} from "./dto";

interface ApiErrorBody {
  code?: string;
  message?: string;
}

export class DemoApiError extends Error {
  constructor(
    message: string,
    public readonly code = "API_ERROR",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DemoApiError";
  }
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...init?.headers,
      },
    });
  } catch (error) {
    throw new DemoApiError(
      "Cannot reach the RepuGate API. Start the project with pnpm dev.",
      "API_UNREACHABLE",
      { cause: error },
    );
  }

  const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
  if (!response.ok) {
    throw new DemoApiError(
      body?.message ?? `RepuGate API returned HTTP ${response.status}`,
      body?.code ?? `HTTP_${response.status}`,
    );
  }

  return body;
}

export async function loadServiceCatalog(): Promise<ServiceCatalogItem[]> {
  const body = await requestJson("/api/services");

  return serviceCatalogSchema.parse(body).services;
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    await requestJson("/health");
    return true;
  } catch {
    return false;
  }
}

export async function loadLiveRegistry(): Promise<LiveRegistryResponse> {
  const body = await requestJson("/api/live/erc8004");
  return liveRegistryResponseSchema.parse(body);
}

export class HttpEvaluationApi implements EvaluationApiPort {
  lastEvaluation: EvaluationResponse | null = null;
  lastPayment: PaymentResponse | null = null;

  async evaluateOffer(request: EvaluationRequest): Promise<EvaluationResponse> {
    const body = await requestJson("/api/evaluations", {
      method: "POST",
      body: JSON.stringify(request),
    });
    this.lastEvaluation = parseEvaluationResponse(body);

    return this.lastEvaluation;
  }

  async consumeGrant(request: ConsumeGrantRequest): Promise<PaymentResponse> {
    const { grantId, ...body } = request;
    const response = await requestJson(`/api/grants/${grantId}/consume`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    this.lastPayment = parsePaymentResponse(response);

    return this.lastPayment;
  }

  async recordPaymentEvent(
    paymentId: string,
    event: ClientPaymentEventRequest,
  ): Promise<PaymentResponse> {
    const response = await requestJson(`/api/payments/${paymentId}/events`, {
      method: "POST",
      body: JSON.stringify(event),
    });
    this.lastPayment = parsePaymentResponse(response);

    return this.lastPayment;
  }
}
