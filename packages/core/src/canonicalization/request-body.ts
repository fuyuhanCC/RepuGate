import { keccak256, toHex } from "viem";

import type { Bytes32 } from "../domain/types";

const EMPTY_BODY = new Uint8Array();

export function hashRequestBody(
  body: string | Uint8Array = EMPTY_BODY,
): Bytes32 {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;

  return keccak256(toHex(bytes));
}
