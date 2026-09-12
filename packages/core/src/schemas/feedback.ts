import { z } from "zod";

import {
  agentReferenceInputSchema,
  bytes32Schema,
  evmAddressSchema,
  httpResourceUrlSchema,
  positiveIntegerStringSchema,
  unsignedIntegerStringSchema,
} from "./offer";

const SIGNED_INTEGER_PATTERN = /^-?(0|[1-9][0-9]*)$/;
const INT128_MIN = -(1n << 127n);
const INT128_MAX = (1n << 127n) - 1n;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);

export const signedInt128StringSchema = z
  .string()
  .regex(SIGNED_INTEGER_PATTERN, "Expected a signed decimal integer string")
  .refine((value) => value !== "-0", "Negative zero is not canonical")
  .refine((value) => {
    try {
      const parsed = BigInt(value);
      return parsed >= INT128_MIN && parsed <= INT128_MAX;
    } catch {
      return false;
    }
  }, "Expected a signed 128-bit integer");

export const feedbackEndpointSchema = z
  .string()
  .max(2_048)
  .refine(
    (value) => value === "" || httpResourceUrlSchema.safeParse(value).success,
    "Expected an empty or HTTP(S) endpoint",
  );

export const feedbackUriSchema = z
  .string()
  .max(2_048)
  .refine((value) => {
    if (value === "") {
      return true;
    }

    if (value.startsWith("ipfs://")) {
      return value.length > "ipfs://".length;
    }

    const parsed = httpResourceUrlSchema.safeParse(value);
    return parsed.success && new URL(parsed.data).protocol === "https:";
  }, "Expected an empty, HTTPS, or IPFS feedback URI");

export const safePositiveIntegerStringSchema = positiveIntegerStringSchema.refine(
  (value) => BigInt(value) <= MAX_SAFE_INTEGER,
  "Expected a positive safe integer string",
);

export const paymentProofInputSchema = z
  .object({
    chainId: safePositiveIntegerStringSchema,
    txHash: bytes32Schema,
    fromAddress: evmAddressSchema,
    toAddress: evmAddressSchema,
    logIndex: z.number().int().nonnegative().safe().optional(),
    authorizationNonce: bytes32Schema.optional(),
  })
  .strict();

export const feedbackRecordInputSchema = z
  .object({
    agent: agentReferenceInputSchema,
    clientAddress: evmAddressSchema,
    feedbackIndex: positiveIntegerStringSchema,
    value: signedInt128StringSchema,
    valueDecimals: z.number().int().min(0).max(18),
    tag1: z.string().max(128).default(""),
    tag2: z.string().max(128).default(""),
    endpoint: feedbackEndpointSchema.optional(),
    feedbackUri: feedbackUriSchema.optional(),
    feedbackHash: bytes32Schema.optional(),
    isRevoked: z.boolean().default(false),
    observedAtBlock: unsignedIntegerStringSchema,
    proofOfPayment: paymentProofInputSchema.optional(),
  })
  .strict();

export const receiptLocatorInputSchema = z
  .object({
    chainId: z.number().int().positive().safe(),
    txHash: bytes32Schema,
    logIndex: z.number().int().nonnegative().safe(),
  })
  .strict();

export type FeedbackRecordInput = z.input<typeof feedbackRecordInputSchema>;

export type ParsedFeedbackRecordInput = z.output<
  typeof feedbackRecordInputSchema
>;

export type PaymentProofInput = z.infer<typeof paymentProofInputSchema>;

export type ReceiptLocatorInput = z.infer<
  typeof receiptLocatorInputSchema
>;
