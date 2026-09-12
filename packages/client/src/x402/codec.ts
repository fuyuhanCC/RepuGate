import type { z } from "zod";

import { TrustedFetchError } from "../errors";

function toBinaryString(bytes: Uint8Array): string {
  let result = "";

  for (const byte of bytes) {
    result += String.fromCharCode(byte);
  }

  return result;
}

function decodeBase64(value: string): Uint8Array {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(trimmed) || trimmed.length % 4 === 1) {
    throw new Error("Header is not valid base64");
  }

  const unpadded = trimmed.replace(/=+$/, "");
  const normalized = unpadded.padEnd(
    unpadded.length + ((4 - (unpadded.length % 4)) % 4),
    "=",
  );
  const binary = atob(normalized);

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function encodeX402Header(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));

  return btoa(toBinaryString(bytes));
}

export function decodeX402Header<T>(
  value: string,
  schema: z.ZodType<T>,
  errorCode: "INVALID_PAYMENT_REQUIRED" | "INVALID_SETTLEMENT_RESPONSE",
): T {
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(
      decodeBase64(value),
    );

    return schema.parse(JSON.parse(json));
  } catch (error) {
    throw new TrustedFetchError(
      errorCode,
      "The x402 header contains invalid base64 JSON or does not match the required schema",
      { cause: error },
    );
  }
}
