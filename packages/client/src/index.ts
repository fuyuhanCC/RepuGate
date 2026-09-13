export { TrustedFetchError } from "./errors";
export type { TrustedFetchErrorCode } from "./errors";

export { GuardedPaymentClient } from "./guarded-payment-client";
export type { PreparedPayment } from "./guarded-payment-client";

export { selectExactEvmOffer } from "./offer-selector";
export type { PaymentSelectionPolicy } from "./offer-selector";

export type {
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

export {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  trustedFetch,
} from "./trusted-fetch";
export type {
  TrustEvaluationConfig,
  TrustedFetchDependencies,
  TrustedFetchOptions,
  TrustedFetchResult,
  TrustedFetchStage,
  TrustedRequestBody,
  TrustedRequestInit,
} from "./trusted-fetch";

export { decodeX402Header, encodeX402Header } from "./x402/codec";
export {
  exactEvmPaymentRequirementsSchema,
  extensionEntrySchema,
  extensionsSchema,
  paymentPayloadSchema,
  paymentRequiredSchema,
  paymentRequirementsSchema,
  repugateAgentInfoSchema,
  resourceInfoSchema,
  settlementResponseSchema,
  signedEvmAuthorizationSchema,
} from "./x402/schemas";
export type {
  ExactEvmPaymentRequirements,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  RepuGateAgentInfo,
  ResourceInfo,
  SettlementResponse,
  SignedEvmAuthorization,
} from "./x402/schemas";
