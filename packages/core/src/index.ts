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

export type {
  Decision,
  FeedbackEvaluation,
  FeedbackRejectionReason,
  OfferEvaluationResult,
  OfferRiskFlag,
  PolicyConfig,
  PolicyDecision,
  ReputationAssessment,
  ReputationEvaluationResult,
  ReputationModel,
  ReputationRiskFlag,
} from "./domain/evaluation";

export type {
  InvalidPaymentEvidence,
  EvidenceClaim,
  PaymentProofVerification,
  PaymentProofVerifier,
  PaymentVerificationFailureCode,
  ReceiptUsageReader,
  VerifiedPaymentEvidence,
} from "./domain/evidence";

export type {
  AuthorizedPaymentIntent,
  EvaluationGrant,
  EvaluationGrantStatus,
  GrantConsumptionBinding,
} from "./domain/grant";

export type {
  PaymentAttempt,
  PaymentEvent,
  PaymentState,
} from "./domain/payment";

export {
  canonicalizeOffer,
  OfferCanonicalizationError,
} from "./canonicalization/offer";

export type { OfferCanonicalizationErrorCode } from "./canonicalization/offer";

export {
  canonicalizeHttpUrl,
  HttpUrlCanonicalizationError,
} from "./canonicalization/http-url";

export { hashRequestBody } from "./canonicalization/request-body";

export type { HttpUrlCanonicalizationErrorCode } from "./canonicalization/http-url";

export { deriveIdentityEpoch } from "./identity/epoch";

export {
  createAuthorizationKey,
  createReceiptKey,
} from "./evidence/receipt-key";

export { normalizeFeedbackRecord } from "./reputation/normalize-feedback";

export {
  BAYESIAN_PRIOR_STRENGTH,
  averageScoreBps,
  confidenceFromDistinctReviewers,
  DEFAULT_MINIMUM_DISTINCT_REVIEWERS,
  MAX_SCORE_BPS,
  toQualityScoreBps,
} from "./reputation/fixed-point";

export { assessB1RawReputation } from "./reputation/b1";
export type { B1AssessmentInput } from "./reputation/b1";

export { assessB0NoGate } from "./reputation/b0";

export { assessB2GroundedReputation } from "./reputation/b2";
export type { B2AssessmentInput } from "./reputation/b2";

export { assessB3Reputation } from "./reputation/b3";
export type { B3AssessmentInput } from "./reputation/b3";

export { assessB3DirichletReputation } from "./reputation/b3-dirichlet";
export type { B3DirichletAssessmentInput } from "./reputation/b3-dirichlet";

export {
  betaPosteriorMeanBps,
  dirichletGoodOrBetterBps,
} from "./reputation/bayesian-score";

export {
  createFeedbackKey,
  filterQualityFeedback,
} from "./reputation/quality-feedback";
export type {
  QualityFeedbackCandidate,
  QualityFeedbackFilterResult,
  QualityFeedbackScope,
} from "./reputation/quality-feedback";

export {
  DEFAULT_POLICY_CONFIG,
  evaluatePolicy,
  hashPolicy,
} from "./policy/evaluate-policy";
export type { EvaluatePolicyInput } from "./policy/evaluate-policy";

export { evaluateReputation } from "./evaluation/evaluate-reputation";
export type {
  B0ReputationEvaluationInput,
  B1ReputationEvaluationInput,
  B2ReputationEvaluationInput,
  B3DirichletReputationEvaluationInput,
  B3ReputationEvaluationInput,
  ReputationEvaluationInput,
} from "./evaluation/evaluate-reputation";

export { evaluateOffer } from "./evaluation/evaluate-offer";
export type {
  Clock,
  EvaluateOfferInput,
  EvaluationPorts,
  FeedbackReader,
  IdentityReader,
} from "./evaluation/evaluate-offer";

export {
  FixedClock,
  FixtureFeedbackReader,
  FixtureIdentityReader,
  FixturePaymentProofVerifier,
  FixtureReceiptUsageReader,
} from "./fixtures/adapters";
export type { PaymentProofFixture } from "./fixtures/adapters";

export {
  createDeterministicScenario,
  DETERMINISTIC_SCENARIO_IDS,
} from "./fixtures/scenarios";

export {
  assertGrantBindingMatches,
  assertGrantConsumable,
  GrantError,
  issueEvaluationGrant,
} from "./grants/grant";
export type {
  GrantErrorCode,
  IssueEvaluationGrantInput,
} from "./grants/grant";

export {
  createPaymentAttempt,
  PaymentTransitionError,
  reducePaymentEvent,
} from "./payments/reduce-payment-event";
export type {
  PaymentTransitionErrorCode,
} from "./payments/reduce-payment-event";
export type {
  DeterministicScenarioContext,
  DeterministicScenarioId,
} from "./fixtures/scenarios";

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
