import {
  bytes32Schema,
  evmAddressSchema,
  evmNetworkSchema,
  httpResourceUrlSchema,
  positiveIntegerStringSchema,
  unsignedIntegerStringSchema,
} from "@repugate/core";
import { z } from "zod";

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const resourceInfoSchema = z
  .object({
    url: httpResourceUrlSchema,
    description: z.string().optional(),
    mimeType: z.string().optional(),
    serviceName: z.string().optional(),
    tags: z.array(z.string()).optional(),
    iconUrl: httpResourceUrlSchema.optional(),
  })
  .passthrough();

export const paymentRequirementsSchema = z
  .object({
    scheme: z.string().min(1),
    network: z.string().min(1),
    amount: z.string().min(1),
    asset: z.string().min(1),
    payTo: z.string().min(1),
    maxTimeoutSeconds: z.number().int().positive(),
    extra: jsonObjectSchema.optional(),
  })
  .passthrough();

export const exactEvmPaymentRequirementsSchema = paymentRequirementsSchema.extend({
  scheme: z.literal("exact"),
  network: evmNetworkSchema,
  amount: positiveIntegerStringSchema,
  asset: evmAddressSchema,
  payTo: evmAddressSchema,
  maxTimeoutSeconds: z.number().int().positive().max(86_400),
});

export const extensionEntrySchema = z
  .object({
    info: jsonObjectSchema,
    schema: jsonObjectSchema,
  })
  .passthrough();

export const extensionsSchema = z.record(z.string(), extensionEntrySchema);

export const paymentRequiredSchema = z
  .object({
    x402Version: z.literal(2),
    error: z.string().optional(),
    resource: resourceInfoSchema,
    accepts: z.array(paymentRequirementsSchema).min(1),
    extensions: extensionsSchema.optional(),
  })
  .passthrough();

export const repugateAgentInfoSchema = z
  .object({
    agentRegistry: evmAddressSchema,
    agentId: unsignedIntegerStringSchema,
    endpointHash: bytes32Schema,
  })
  .strict();

export const signedEvmAuthorizationSchema = z
  .object({
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    authorization: z
      .object({
        from: evmAddressSchema,
        to: evmAddressSchema,
        value: positiveIntegerStringSchema,
        validAfter: unsignedIntegerStringSchema,
        validBefore: unsignedIntegerStringSchema,
        nonce: bytes32Schema,
      })
      .strict(),
  })
  .strict();

export const settlementResponseSchema = z
  .object({
    success: z.boolean(),
    errorReason: z.string().optional(),
    payer: evmAddressSchema.optional(),
    transaction: z.string(),
    network: z.string().min(1),
    amount: unsignedIntegerStringSchema.optional(),
    extensions: jsonObjectSchema.optional(),
  })
  .passthrough();

export const paymentPayloadSchema = z
  .object({
    x402Version: z.literal(2),
    resource: resourceInfoSchema,
    accepted: exactEvmPaymentRequirementsSchema,
    payload: signedEvmAuthorizationSchema,
    extensions: extensionsSchema.optional(),
  })
  .strict();

export type ResourceInfo = z.infer<typeof resourceInfoSchema>;
export type PaymentRequirements = z.infer<typeof paymentRequirementsSchema>;
export type ExactEvmPaymentRequirements = z.infer<
  typeof exactEvmPaymentRequirementsSchema
>;
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;
export type RepuGateAgentInfo = z.infer<typeof repugateAgentInfoSchema>;
export type SignedEvmAuthorization = z.infer<
  typeof signedEvmAuthorizationSchema
>;
export type SettlementResponse = z.infer<typeof settlementResponseSchema>;
export type PaymentPayload = z.infer<typeof paymentPayloadSchema>;
