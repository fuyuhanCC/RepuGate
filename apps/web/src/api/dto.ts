import type {
  Address,
  AuthorizedPaymentIntent,
  Bytes32,
  EvaluationGrant,
  FeedbackEvaluation,
  IdentitySnapshot,
  OfferEvaluationResult,
  PaymentAttempt,
} from "@repugate/core";
import {
  agentReferenceInputSchema,
  bytes32Schema,
  canonicalOfferInputSchema,
  canonicalizeOffer,
  evmAddressSchema,
  httpResourceUrlSchema,
  unsignedIntegerStringSchema,
} from "@repugate/core";
import { z } from "zod";

const feedbackRejectionReasonSchema = z.enum([
  "AGENT_MISMATCH",
  "ENDPOINT_MISMATCH",
  "ENDPOINT_MISSING",
  "INVALID_PAYMENT",
  "IDENTITY_EPOCH_MISMATCH",
  "MISSING_PAYMENT_PROOF",
  "PAYMENT_AFTER_FEEDBACK",
  "PAYER_MISMATCH",
  "PAYMENT_PROOF_MISMATCH",
  "RECEIPT_REPLAY",
  "RECIPIENT_MISMATCH",
  "REVOKED",
  "TAG_MISMATCH",
  "VALUE_OUT_OF_RANGE",
]);

const reputationRiskFlagSchema = z.enum([
  "INVALID_PAYMENT_PRESENT",
  "LOW_DISTINCT_REVIEWER_COUNT",
  "NO_ELIGIBLE_FEEDBACK",
  "NO_VERIFIED_FEEDBACK",
  "REPLAY_ATTEMPT_PRESENT",
  "UNGROUNDED_FEEDBACK_PRESENT",
]);

const offerRiskFlagSchema = z.enum([
  "AGENT_REFERENCE_MISMATCH",
  "ENDPOINT_HASH_MISMATCH",
  "OFFER_HASH_MISMATCH",
  "PAY_TO_MISMATCH",
  "RESOURCE_ENDPOINT_MISMATCH",
]);

const feedbackEvaluationSchema = z
  .object({
    feedbackKey: z.string(),
    clientAddress: evmAddressSchema,
    status: z.enum(["ACCEPTED", "REJECTED"]),
    scoreBps: z.number().int().optional(),
    reason: feedbackRejectionReasonSchema.optional(),
    detail: z.string().optional(),
    receiptKey: z.string().optional(),
    authorizationKey: z.string().optional(),
  })
  .strict();

const identitySnapshotDtoSchema = z
  .object({
    agent: agentReferenceInputSchema,
    owner: evmAddressSchema,
    agentWallet: evmAddressSchema,
    registeredEndpoint: httpResourceUrlSchema,
    endpointHash: bytes32Schema,
    agentUriHash: bytes32Schema,
    identityEpoch: bytes32Schema,
    observedAtBlock: unsignedIntegerStringSchema,
  })
  .strict();

const offerEvaluationDtoSchema = z
  .object({
    model: z.enum([
      "B0_NO_GATE",
      "B1_RAW",
      "B2_GROUNDED",
      "B3_REPUGATE",
      "B3_DIRICHLET",
    ]),
    rawScoreBps: z.number().int().nullable(),
    verifiedScoreBps: z.number().int().nullable(),
    confidenceBps: z.number().int().nullable(),
    distinctReviewerCount: z.number().int().nonnegative(),
    acceptedFeedback: z.array(feedbackEvaluationSchema),
    rejectedFeedback: z.array(feedbackEvaluationSchema),
    riskFlags: z.array(reputationRiskFlagSchema),
    decision: z.enum(["ALLOW", "REVIEW", "BLOCK"]),
    decisionReasons: z.array(z.string()),
    policyHash: bytes32Schema,
    canonicalOffer: canonicalOfferInputSchema,
    offerHash: bytes32Schema,
    identity: identitySnapshotDtoSchema,
    identityMatched: z.boolean(),
    offerRiskFlags: z.array(offerRiskFlagSchema),
    evaluatedAt: z.number().int().nonnegative(),
  })
  .strict();

const evaluationGrantDtoSchema = z
  .object({
    id: z.string(),
    decisionId: z.string(),
    offerHash: bytes32Schema,
    identityEpoch: bytes32Schema,
    buyer: evmAddressSchema,
    policyHash: bytes32Schema,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    status: z.enum(["ISSUED", "CONSUMED", "EXPIRED"]),
  })
  .strict();

const evaluationResponseDtoSchema = z
  .object({
    decisionId: z.string(),
    evaluation: offerEvaluationDtoSchema,
    grant: evaluationGrantDtoSchema.nullable(),
  })
  .strict();

const paymentAttemptSchema = z
  .object({
    paymentId: z.string(),
    grantId: z.string(),
    state: z.enum([
      "AUTHORIZED",
      "CREATED",
      "FAILED",
      "SETTLED",
      "SETTLEMENT_PENDING",
      "SUBMITTED",
    ]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    transactionHash: bytes32Schema.optional(),
    failureCode: z.string().optional(),
  })
  .strict();

const authorizedPaymentIntentDtoSchema = z
  .object({
    paymentId: z.string(),
    grantId: z.string(),
    buyer: evmAddressSchema,
    offerHash: bytes32Schema,
    identityEpoch: bytes32Schema,
    policyHash: bytes32Schema,
    offer: canonicalOfferInputSchema,
  })
  .strict();

const paymentResponseDtoSchema = z
  .object({
    payment: paymentAttemptSchema,
    authorizedIntent: authorizedPaymentIntentDtoSchema,
  })
  .strict();

export const serviceCatalogItemSchema = z
  .object({
    id: z.enum([
      "honest-service",
      "ungrounded-feedback",
      "receipt-replay",
      "reviewer-concentration",
      "offer-substitution",
    ]),
    title: z.string(),
    description: z.string(),
    offer: canonicalOfferInputSchema,
    expectedOffer: canonicalOfferInputSchema,
    expectedOfferHash: bytes32Schema,
  })
  .strict();

export const serviceCatalogSchema = z
  .object({ services: z.array(serviceCatalogItemSchema) })
  .strict();

export type ServiceCatalogItem = z.infer<typeof serviceCatalogItemSchema>;

const liveRegistryDisabledSchema = z
  .object({
    enabled: z.literal(false),
    source: z.literal("disabled"),
    fixtureMode: z.literal("available"),
  })
  .strict();

const liveRegistryEnabledSchema = z
  .object({
    enabled: z.literal(true),
    source: z.literal("live-rpc"),
    fixtureMode: z.literal("available"),
    model: z.literal("B1_RAW"),
    chainId: z.number().int().positive(),
    identityRegistry: evmAddressSchema,
    reputationRegistry: evmAddressSchema,
    feedbackFromBlock: unsignedIntegerStringSchema,
    identity: identitySnapshotDtoSchema,
    feedbackCount: z.number().int().nonnegative(),
    rawScoreBps: z.number().int().nullable(),
    confidenceBps: z.number().int().min(0).max(10_000),
    distinctReviewerCount: z.number().int().nonnegative(),
    eligibleFeedbackCount: z.number().int().nonnegative(),
    rejectedFeedbackCount: z.number().int().nonnegative(),
    riskFlags: z.array(reputationRiskFlagSchema),
  })
  .strict();

export const liveRegistryResponseSchema = z.discriminatedUnion("enabled", [
  liveRegistryDisabledSchema,
  liveRegistryEnabledSchema,
]);

export type LiveRegistryResponse = z.infer<
  typeof liveRegistryResponseSchema
>;

function toIdentitySnapshot(
  dto: z.infer<typeof identitySnapshotDtoSchema>,
): IdentitySnapshot {
  return {
    agent: {
      chainId: dto.agent.chainId,
      registry: dto.agent.registry as Address,
      agentId: BigInt(dto.agent.agentId),
    },
    owner: dto.owner as Address,
    agentWallet: dto.agentWallet as Address,
    registeredEndpoint: dto.registeredEndpoint,
    endpointHash: dto.endpointHash as Bytes32,
    agentUriHash: dto.agentUriHash as Bytes32,
    identityEpoch: dto.identityEpoch as Bytes32,
    observedAtBlock: BigInt(dto.observedAtBlock),
  };
}

function toEvaluation(
  dto: z.infer<typeof offerEvaluationDtoSchema>,
): OfferEvaluationResult {
  return {
    ...dto,
    policyHash: dto.policyHash as Bytes32,
    canonicalOffer: canonicalizeOffer(dto.canonicalOffer).offer,
    offerHash: dto.offerHash as Bytes32,
    identity: toIdentitySnapshot(dto.identity),
    acceptedFeedback: dto.acceptedFeedback as FeedbackEvaluation[],
    rejectedFeedback: dto.rejectedFeedback as FeedbackEvaluation[],
  };
}

function toGrant(
  dto: z.infer<typeof evaluationGrantDtoSchema>,
): EvaluationGrant {
  return {
    ...dto,
    offerHash: dto.offerHash as Bytes32,
    identityEpoch: dto.identityEpoch as Bytes32,
    buyer: dto.buyer as Address,
    policyHash: dto.policyHash as Bytes32,
  };
}

function toPaymentAttempt(
  dto: z.infer<typeof paymentAttemptSchema>,
): PaymentAttempt {
  const { transactionHash, ...attempt } = dto;

  return {
    ...attempt,
    ...(transactionHash === undefined
      ? {}
      : { transactionHash: transactionHash as Bytes32 }),
  };
}

function toAuthorizedIntent(
  dto: z.infer<typeof authorizedPaymentIntentDtoSchema>,
): AuthorizedPaymentIntent {
  return {
    paymentId: dto.paymentId,
    grantId: dto.grantId,
    buyer: dto.buyer as Address,
    offerHash: dto.offerHash as Bytes32,
    identityEpoch: dto.identityEpoch as Bytes32,
    policyHash: dto.policyHash as Bytes32,
    offer: canonicalizeOffer(dto.offer).offer,
  };
}

export function parseEvaluationResponse(value: unknown) {
  const dto = evaluationResponseDtoSchema.parse(value);

  return {
    decisionId: dto.decisionId,
    evaluation: toEvaluation(dto.evaluation),
    grant: dto.grant === null ? null : toGrant(dto.grant),
  };
}

export function parsePaymentResponse(value: unknown) {
  const dto = paymentResponseDtoSchema.parse(value);

  return {
    payment: toPaymentAttempt(dto.payment),
    authorizedIntent: toAuthorizedIntent(dto.authorizedIntent),
  };
}
