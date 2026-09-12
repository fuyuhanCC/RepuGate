import type { Address, AgentReference, Bytes32 } from "./types";

export interface PaymentProof {
  chainId: number;
  txHash: Bytes32;
  fromAddress: Address;
  toAddress: Address;
  logIndex?: number;
  authorizationNonce?: Bytes32;
}

export interface FeedbackRecord {
  agent: AgentReference;
  clientAddress: Address;
  feedbackIndex: bigint;
  value: bigint;
  valueDecimals: number;
  tag1: string;
  tag2: string;
  endpoint?: string;
  feedbackUri?: string;
  feedbackHash?: Bytes32;
  isRevoked: boolean;
  observedAtBlock: bigint;
  proofOfPayment?: PaymentProof;
}

export interface ReceiptLocator {
  chainId: number;
  txHash: Bytes32;
  logIndex: number;
}

export type ReceiptKey = `eip155:${number}:tx:${string}:log:${number}`;

export type AuthorizationKey = `eip155:${number}:nonce:${string}`;
