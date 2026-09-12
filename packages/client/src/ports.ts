import type {
  Address,
  AuthorizedPaymentIntent,
  Bytes32,
  CanonicalOfferInput,
  EvaluationGrant,
  OfferEvaluationResult,
  PaymentAttempt,
  ReputationModel,
} from "@repugate/core";

import type { SignedEvmAuthorization } from "./x402/schemas";

export interface FetchPort {
  fetch(input: string, init: RequestInit): Promise<Response>;
}

export interface WalletPort {
  getAddress(): Promise<Address>;
  getChainId(): Promise<number>;
  signX402Authorization(
    intent: AuthorizedPaymentIntent,
  ): Promise<SignedEvmAuthorization>;
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

export interface EvaluationResponse {
  decisionId: string;
  evaluation: OfferEvaluationResult;
  grant: EvaluationGrant | null;
}

export interface ConsumeGrantRequest {
  grantId: string;
  buyer: Address;
  offerHash: Bytes32;
  identityEpoch: Bytes32;
  policyHash: Bytes32;
  idempotencyKey: string;
}

export interface PaymentResponse {
  payment: PaymentAttempt;
  authorizedIntent: AuthorizedPaymentIntent;
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

export interface EvaluationApiPort {
  evaluateOffer(request: EvaluationRequest): Promise<EvaluationResponse>;
  consumeGrant(request: ConsumeGrantRequest): Promise<PaymentResponse>;
  recordPaymentEvent(
    paymentId: string,
    event: ClientPaymentEventRequest,
  ): Promise<PaymentResponse>;
}

export interface IdempotencyKeyGenerator {
  next(scope: "consume" | "evaluate" | "payment-event"): string;
}
