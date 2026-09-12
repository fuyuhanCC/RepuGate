export type {
  Address,
  AgentReference,
  Bytes32,
  CanonicalOffer,
  CanonicalizedOffer,
  EvmNetwork,
  Hex,
  HttpMethod,
  IdentitySnapshot,
} from "./domain/types";

export type {
  AuthorizationKey,
  FeedbackRecord,
  PaymentProof,
  ReceiptKey,
  ReceiptLocator,
} from "./domain/reputation";

export {
  canonicalizeOffer,
  OfferCanonicalizationError,
} from "./canonicalization/offer";

export type { OfferCanonicalizationErrorCode } from "./canonicalization/offer";

export {
  canonicalizeHttpUrl,
  HttpUrlCanonicalizationError,
} from "./canonicalization/http-url";

export type { HttpUrlCanonicalizationErrorCode } from "./canonicalization/http-url";

export { deriveIdentityEpoch } from "./identity/epoch";

export {
  createAuthorizationKey,
  createReceiptKey,
} from "./evidence/receipt-key";

export { normalizeFeedbackRecord } from "./reputation/normalize-feedback";

export {
  agentReferenceInputSchema,
  bytes32Schema,
  canonicalOfferInputSchema,
  evmAddressSchema,
  evmNetworkSchema,
  httpResourceUrlSchema,
  positiveIntegerStringSchema,
  unsignedIntegerStringSchema,
} from "./schemas/offer";

export type {
  AgentReferenceInput,
  CanonicalOfferInput,
} from "./schemas/offer";

export { identitySnapshotInputSchema } from "./schemas/identity";

export type { IdentitySnapshotInput } from "./schemas/identity";

export {
  feedbackEndpointSchema,
  feedbackRecordInputSchema,
  feedbackUriSchema,
  paymentProofInputSchema,
  receiptLocatorInputSchema,
  safePositiveIntegerStringSchema,
  signedInt128StringSchema,
} from "./schemas/feedback";

export type {
  FeedbackRecordInput,
  ParsedFeedbackRecordInput,
  PaymentProofInput,
  ReceiptLocatorInput,
} from "./schemas/feedback";
