import type { Bytes32 } from "./types";

export type PaymentState =
  | "AUTHORIZED"
  | "CREATED"
  | "FAILED"
  | "SETTLED"
  | "SETTLEMENT_PENDING"
  | "SUBMITTED";

export interface PaymentAttempt {
  paymentId: string;
  grantId: string;
  state: PaymentState;
  createdAt: number;
  updatedAt: number;
  transactionHash?: Bytes32;
  failureCode?: string;
}

export type PaymentEvent =
  | { type: "WALLET_AUTHORIZED"; occurredAt: number }
  | { type: "PAYMENT_SUBMITTED"; occurredAt: number }
  | {
      type: "SETTLEMENT_RECEIVED";
      occurredAt: number;
      transactionHash: Bytes32;
    }
  | {
      type: "SETTLEMENT_VERIFIED";
      occurredAt: number;
      transactionHash: Bytes32;
    }
  | { type: "PAYMENT_FAILED"; occurredAt: number; failureCode: string };
