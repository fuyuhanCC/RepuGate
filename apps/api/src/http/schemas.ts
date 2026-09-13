import {
  bytes32Schema,
  canonicalOfferInputSchema,
  evmAddressSchema,
} from "@repugate/core";
import { z } from "zod";

const identifierSchema = z.string().min(1).max(200);
const idempotencyKeySchema = z.string().min(8).max(200);

export const scenarioIdSchema = z.enum([
  "honest-service",
  "ungrounded-feedback",
  "receipt-replay",
  "reviewer-concentration",
  "offer-substitution",
]);

export const evaluationRequestSchema = z
  .object({
    buyer: evmAddressSchema,
    model: z.enum([
      "B1_RAW",
      "B2_GROUNDED",
      "B3_REPUGATE",
      "B3_DIRICHLET",
    ]),
    scenarioId: scenarioIdSchema.default("honest-service"),
    offer: canonicalOfferInputSchema,
    expectedOfferHash: bytes32Schema,
    idempotencyKey: idempotencyKeySchema,
    tag1: z.string().min(1).max(64).optional(),
    tag2: z.string().min(1).max(64).optional(),
  })
  .strict();

export const consumeGrantRequestSchema = z
  .object({
    buyer: evmAddressSchema,
    offerHash: bytes32Schema,
    identityEpoch: bytes32Schema,
    policyHash: bytes32Schema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const eventBase = {
  idempotencyKey: idempotencyKeySchema,
};

export const clientPaymentEventRequestSchema = z.discriminatedUnion(
  "eventType",
  [
    z
      .object({
        ...eventBase,
        eventType: z.literal("WALLET_AUTHORIZED"),
      })
      .strict(),
    z
      .object({
        ...eventBase,
        eventType: z.literal("PAYMENT_SUBMITTED"),
      })
      .strict(),
    z
      .object({
        ...eventBase,
        eventType: z.literal("SETTLEMENT_RECEIVED"),
        transactionHash: bytes32Schema,
      })
      .strict(),
    z
      .object({
        ...eventBase,
        eventType: z.literal("PAYMENT_FAILED"),
        failureCode: z.string().min(1).max(100),
      })
      .strict(),
  ],
);

export const decisionParamsSchema = z
  .object({ decisionId: identifierSchema })
  .strict();

export const grantParamsSchema = z
  .object({ grantId: identifierSchema })
  .strict();

export const paymentParamsSchema = z
  .object({ paymentId: identifierSchema })
  .strict();
