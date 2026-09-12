import { z } from "zod";

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BYTES_32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const EVM_CAIP_2_PATTERN = /^eip155:(0|[1-9][0-9]*)$/;
const UNSIGNED_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const HTTP_METHOD_PATTERN = /^[A-Za-z]+$/;

export const evmAddressSchema = z
  .string()
  .regex(EVM_ADDRESS_PATTERN, "Expected a 20-byte EVM address");

export const bytes32Schema = z
  .string()
  .regex(BYTES_32_PATTERN, "Expected a 32-byte hex value");

export const evmNetworkSchema = z
  .string()
  .regex(EVM_CAIP_2_PATTERN, "Expected an EVM CAIP-2 network identifier");

export const unsignedIntegerStringSchema = z
  .string()
  .regex(UNSIGNED_INTEGER_PATTERN, "Expected an unsigned decimal integer string");

export const positiveIntegerStringSchema = z
  .string()
  .regex(POSITIVE_INTEGER_PATTERN, "Expected a positive decimal integer string");

export const httpResourceUrlSchema = z.url().refine(
  (value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  },
  "Expected an HTTP or HTTPS URL",
);

export const agentReferenceInputSchema = z
  .object({
    chainId: z.number().int().positive().safe(),
    registry: evmAddressSchema,
    agentId: unsignedIntegerStringSchema,
  })
  .strict();

export const canonicalOfferInputSchema = z
  .object({
    method: z.string().min(1).max(16).regex(HTTP_METHOD_PATTERN),
    resourceUrl: httpResourceUrlSchema,
    endpointHash: bytes32Schema,
    requestBodyHash: bytes32Schema,
    scheme: z.literal("exact"),
    network: evmNetworkSchema,
    asset: evmAddressSchema,
    amount: positiveIntegerStringSchema,
    payTo: evmAddressSchema,
    maxTimeoutSeconds: z.number().int().positive().max(86_400),
    agent: agentReferenceInputSchema,
  })
  .strict();

export type AgentReferenceInput = z.infer<typeof agentReferenceInputSchema>;

export type CanonicalOfferInput = z.infer<typeof canonicalOfferInputSchema>;
