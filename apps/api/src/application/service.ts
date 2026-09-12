import type {
  Address,
  AuthorizedPaymentIntent,
  Bytes32,
  CanonicalOffer,
  EvaluationGrant,
  EvaluationPorts,
  GrantConsumptionBinding,
  PaymentAttempt,
  PaymentEvent,
  ReputationModel,
} from "@repugate/core";
import {
  assertGrantBindingMatches,
  assertGrantConsumable,
  canonicalizeOffer,
  createPaymentAttempt,
  evaluateOffer,
  GrantError,
  issueEvaluationGrant,
  PaymentTransitionError,
  reducePaymentEvent,
} from "@repugate/core";
import type { CanonicalOfferInput } from "@repugate/core";

import type {
  ApiDatabase,
  StoredPayment,
} from "../database/database";
import {
  stringifyInternalJson,
  toJsonCompatible,
} from "../serialization/json";
import { ApplicationError, notFound } from "./errors";

export interface IdGenerator {
  next(prefix: "decision" | "grant" | "payment"): string;
}

export interface EvaluationRequest {
  buyer: Address;
  model: ReputationModel;
  scenarioId: string;
  offer: CanonicalOfferInput;
  expectedOfferHash: Bytes32;
  idempotencyKey: string;
  tag1?: string;
  tag2?: string;
}

export interface ConsumeGrantRequest extends GrantConsumptionBinding {
  grantId: string;
  idempotencyKey: string;
}

export type ClientPaymentEventRequest =
  | { eventType: "WALLET_AUTHORIZED"; idempotencyKey: string }
  | { eventType: "PAYMENT_SUBMITTED"; idempotencyKey: string }
  | {
      eventType: "SETTLEMENT_RECEIVED";
      idempotencyKey: string;
      transactionHash: Bytes32;
    }
  | {
      eventType: "PAYMENT_FAILED";
      idempotencyKey: string;
      failureCode: string;
    };

export interface RepuGateServiceDependencies {
  database: ApiDatabase;
  idGenerator: IdGenerator;
  now: () => number;
  grantLifetimeSeconds: number;
  resolveEvaluationPorts(
    scenarioId: string,
    model: ReputationModel,
  ): EvaluationPorts;
}

function canonicalOfferToInput(offer: CanonicalOffer): CanonicalOfferInput {
  return {
    method: offer.method,
    resourceUrl: offer.resourceUrl,
    endpointHash: offer.endpointHash,
    requestBodyHash: offer.requestBodyHash,
    scheme: offer.scheme,
    network: offer.network,
    asset: offer.asset,
    amount: offer.amount.toString(),
    payTo: offer.payTo,
    maxTimeoutSeconds: offer.maxTimeoutSeconds,
    agent: {
      chainId: offer.agent.chainId,
      registry: offer.agent.registry,
      agentId: offer.agent.agentId.toString(),
    },
  };
}

function mapGrantError(error: GrantError): ApplicationError {
  return new ApplicationError(error.code, error.message, 409);
}

function mapTransitionError(error: PaymentTransitionError): ApplicationError {
  return new ApplicationError(error.code, error.message, 409);
}

function assertIdempotentGrantRetry(
  existing: StoredPayment,
  grant: EvaluationGrant,
  request: ConsumeGrantRequest,
): void {
  if (existing.attempt.grantId !== request.grantId) {
    throw new ApplicationError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency key belongs to another grant consumption",
      409,
    );
  }

  try {
    assertGrantBindingMatches(grant, request);
  } catch (error) {
    if (error instanceof GrantError) {
      throw mapGrantError(error);
    }
    throw error;
  }
}

function buildPaymentEvent(
  request: ClientPaymentEventRequest,
  occurredAt: number,
): PaymentEvent {
  switch (request.eventType) {
    case "WALLET_AUTHORIZED":
      return { type: "WALLET_AUTHORIZED", occurredAt };
    case "PAYMENT_SUBMITTED":
      return { type: "PAYMENT_SUBMITTED", occurredAt };
    case "SETTLEMENT_RECEIVED":
      return {
        type: "SETTLEMENT_RECEIVED",
        occurredAt,
        transactionHash: request.transactionHash,
      };
    case "PAYMENT_FAILED":
      return {
        type: "PAYMENT_FAILED",
        occurredAt,
        failureCode: request.failureCode,
      };
  }
}

function paymentResponse(stored: StoredPayment): unknown {
  return toJsonCompatible({
    payment: stored.attempt,
    authorizedIntent: stored.intent,
  });
}

function evaluationRequestFingerprint(request: EvaluationRequest): string {
  return JSON.stringify({
    buyer: request.buyer.toLowerCase(),
    model: request.model,
    scenarioId: request.scenarioId,
    offerHash: canonicalizeOffer(request.offer).offerHash,
    expectedOfferHash: request.expectedOfferHash.toLowerCase(),
    tag1: request.tag1 ?? null,
    tag2: request.tag2 ?? null,
  });
}

function readIdempotentDecision(
  existing: ReturnType<ApiDatabase["findDecisionByIdempotencyKey"]>,
  requestJson: string,
): unknown | null {
  if (existing === null) {
    return null;
  }
  if (existing.requestJson !== requestJson) {
    throw new ApplicationError(
      "IDEMPOTENCY_KEY_REUSED",
      "Idempotency key belongs to a different evaluation request",
      409,
    );
  }

  return JSON.parse(existing.resultJson) as unknown;
}

export class RepuGateService {
  constructor(private readonly dependencies: RepuGateServiceDependencies) {}

  async evaluateAndIssueGrant(request: EvaluationRequest): Promise<unknown> {
    const requestJson = evaluationRequestFingerprint(request);
    const existingResponse = readIdempotentDecision(
      this.dependencies.database.findDecisionByIdempotencyKey(
        request.idempotencyKey,
      ),
      requestJson,
    );
    if (existingResponse !== null) {
      return existingResponse;
    }

    const ports = this.dependencies.resolveEvaluationPorts(
      request.scenarioId,
      request.model,
    );
    const evaluation = await evaluateOffer(
      {
        offer: request.offer,
        model: request.model,
        expectedOfferHash: request.expectedOfferHash,
        tag1: request.tag1,
        tag2: request.tag2,
      },
      ports,
    );
    const createdAt = this.dependencies.now();
    const decisionId = this.dependencies.idGenerator.next("decision");
    const grant =
      evaluation.decision === "ALLOW"
        ? issueEvaluationGrant({
            id: this.dependencies.idGenerator.next("grant"),
            decisionId,
            buyer: request.buyer,
            evaluation,
            issuedAt: createdAt,
            lifetimeSeconds: this.dependencies.grantLifetimeSeconds,
          })
        : null;
    const response = {
      decisionId,
      evaluation,
      grant,
    };

    return this.dependencies.database.transaction(() => {
      const inserted = this.dependencies.database.insertDecision({
        id: decisionId,
        buyer: request.buyer,
        idempotencyKey: request.idempotencyKey,
        requestJson,
        resultJson: JSON.stringify(toJsonCompatible(response)),
        offerJson: JSON.stringify(
          canonicalOfferToInput(evaluation.canonicalOffer),
        ),
        createdAt,
      });
      if (!inserted) {
        const concurrentResponse = readIdempotentDecision(
          this.dependencies.database.findDecisionByIdempotencyKey(
            request.idempotencyKey,
          ),
          requestJson,
        );
        if (concurrentResponse === null) {
          throw new ApplicationError(
            "ID_GENERATION_COLLISION",
            "Generated decision identifier is already in use",
            500,
          );
        }
        return concurrentResponse;
      }
      if (grant !== null) {
        this.dependencies.database.insertGrant(grant);
      }

      return toJsonCompatible(response);
    });
  }

  getDecision(decisionId: string): unknown {
    const decision = this.dependencies.database.findDecision(decisionId);
    if (decision === null) {
      throw notFound("decision");
    }

    return JSON.parse(decision.resultJson) as unknown;
  }

  consumeGrant(request: ConsumeGrantRequest): unknown {
    return this.dependencies.database.transaction(() => {
      const existing =
        this.dependencies.database.findPaymentByIdempotencyKey(
          request.idempotencyKey,
        );

      if (existing !== null) {
        const existingGrant = this.dependencies.database.findGrant(
          existing.attempt.grantId,
        );
        if (existingGrant === null) {
          throw new ApplicationError(
            "DATA_INTEGRITY_ERROR",
            "Payment refers to a missing grant",
            500,
          );
        }
        assertIdempotentGrantRetry(existing, existingGrant, request);
        return paymentResponse(existing);
      }

      const grant = this.dependencies.database.findGrant(request.grantId);
      if (grant === null) {
        throw notFound("grant");
      }

      const consumedAt = this.dependencies.now();
      try {
        assertGrantConsumable(grant, request, consumedAt);
      } catch (error) {
        if (error instanceof GrantError) {
          throw mapGrantError(error);
        }
        throw error;
      }

      if (!this.dependencies.database.markGrantConsumed(grant.id)) {
        throw new ApplicationError(
          "GRANT_ALREADY_CONSUMED",
          "Evaluation grant has already been consumed",
          409,
        );
      }

      const decision = this.dependencies.database.findDecision(
        grant.decisionId,
      );
      if (decision === null) {
        throw new ApplicationError(
          "DATA_INTEGRITY_ERROR",
          "Grant refers to a missing decision",
          500,
        );
      }
      const storedOffer = JSON.parse(decision.offerJson) as CanonicalOfferInput;
      const canonicalized = canonicalizeOffer(storedOffer);
      if (
        canonicalized.offerHash.toLowerCase() !== grant.offerHash.toLowerCase()
      ) {
        throw new ApplicationError(
          "DATA_INTEGRITY_ERROR",
          "Stored offer does not match its grant",
          500,
        );
      }

      const paymentId = this.dependencies.idGenerator.next("payment");
      const attempt = createPaymentAttempt({
        paymentId,
        grantId: grant.id,
        createdAt: consumedAt,
      });
      const intent: AuthorizedPaymentIntent = {
        paymentId,
        grantId: grant.id,
        buyer: grant.buyer,
        offerHash: grant.offerHash,
        identityEpoch: grant.identityEpoch,
        policyHash: grant.policyHash,
        offer: canonicalized.offer,
      };

      this.dependencies.database.insertPayment({
        attempt,
        intentJson: stringifyInternalJson(intent),
        idempotencyKey: request.idempotencyKey,
      });

      return paymentResponse({
        attempt,
        intent,
        idempotencyKey: request.idempotencyKey,
      });
    });
  }

  recordPaymentEvent(
    paymentId: string,
    request: ClientPaymentEventRequest,
  ): unknown {
    return this.dependencies.database.transaction(() => {
      const requestJson = JSON.stringify(request);
      const existingEvent = this.dependencies.database.findPaymentEvent(
        paymentId,
        request.idempotencyKey,
      );
      if (existingEvent !== null) {
        if (existingEvent !== requestJson) {
          throw new ApplicationError(
            "IDEMPOTENCY_KEY_REUSED",
            "Idempotency key belongs to a different payment event",
            409,
          );
        }
        return this.getPayment(paymentId);
      }

      const stored = this.dependencies.database.findPayment(paymentId);
      if (stored === null) {
        throw notFound("payment");
      }
      if (
        stored.attempt.state === "SETTLEMENT_PENDING" &&
        request.eventType === "PAYMENT_FAILED"
      ) {
        throw new ApplicationError(
          "SETTLEMENT_RECONCILIATION_REQUIRED",
          "A pending settlement can only be resolved by server verification",
          409,
        );
      }
      const event = buildPaymentEvent(request, this.dependencies.now());
      let updated: PaymentAttempt;

      try {
        updated = reducePaymentEvent(stored.attempt, event);
      } catch (error) {
        if (error instanceof PaymentTransitionError) {
          throw mapTransitionError(error);
        }
        throw error;
      }

      this.dependencies.database.insertPaymentEvent({
        paymentId,
        idempotencyKey: request.idempotencyKey,
        eventType: event.type,
        eventJson: requestJson,
        occurredAt: event.occurredAt,
      });
      this.dependencies.database.updatePayment(updated);

      return paymentResponse({ ...stored, attempt: updated });
    });
  }

  getPayment(paymentId: string): unknown {
    const payment = this.dependencies.database.findPayment(paymentId);
    if (payment === null) {
      throw notFound("payment");
    }

    return paymentResponse(payment);
  }
}
