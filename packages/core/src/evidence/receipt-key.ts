import type {
  AuthorizationKey,
  ReceiptKey,
  ReceiptLocator,
} from "../domain/reputation";
import type { Bytes32 } from "../domain/types";

export function createReceiptKey(locator: ReceiptLocator): ReceiptKey {
  return `eip155:${locator.chainId}:tx:${locator.txHash.toLowerCase()}:log:${locator.logIndex}`;
}

export function createAuthorizationKey(
  chainId: number,
  nonce: Bytes32,
): AuthorizationKey {
  return `eip155:${chainId}:nonce:${nonce.toLowerCase()}`;
}
