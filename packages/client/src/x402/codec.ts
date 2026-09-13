import {
  decodeX402Header as decodeProtocolHeader,
  encodeX402Header,
} from "@repugate/x402";
import { TrustedFetchError } from "../errors";
import type { z } from "zod";

export { encodeX402Header };

export function decodeX402Header<T>(
  value: string,
  schema: z.ZodType<T>,
  errorCode: "INVALID_PAYMENT_REQUIRED" | "INVALID_SETTLEMENT_RESPONSE",
): T {
  try {
    return decodeProtocolHeader(value, schema);
  } catch (error) {
    throw new TrustedFetchError(
      errorCode,
      "The x402 header contains invalid base64 JSON or does not match the required schema",
      { cause: error },
    );
  }
}
