import { describe, expect, it } from "vitest";

import type { Bytes32 } from "../domain/types";
import {
  createPaymentAttempt,
  PaymentTransitionError,
  reducePaymentEvent,
} from "./reduce-payment-event";

const TX_HASH = `0x${"aa".repeat(32)}` as Bytes32;

describe("payment event reducer", () => {
  it("follows the authorized settlement path", () => {
    const created = createPaymentAttempt({
      paymentId: "payment-1",
      grantId: "grant-1",
      createdAt: 100,
    });
    const authorized = reducePaymentEvent(created, {
      type: "WALLET_AUTHORIZED",
      occurredAt: 101,
    });
    const submitted = reducePaymentEvent(authorized, {
      type: "PAYMENT_SUBMITTED",
      occurredAt: 102,
    });
    const pending = reducePaymentEvent(submitted, {
      type: "SETTLEMENT_RECEIVED",
      transactionHash: TX_HASH,
      occurredAt: 103,
    });
    const settled = reducePaymentEvent(pending, {
      type: "SETTLEMENT_VERIFIED",
      transactionHash: TX_HASH,
      occurredAt: 104,
    });

    expect(settled).toMatchObject({
      state: "SETTLED",
      transactionHash: TX_HASH,
      updatedAt: 104,
    });
  });

  it("allows a controlled failure but keeps final states terminal", () => {
    const created = createPaymentAttempt({
      paymentId: "payment-1",
      grantId: "grant-1",
      createdAt: 100,
    });
    const failed = reducePaymentEvent(created, {
      type: "PAYMENT_FAILED",
      failureCode: "WALLET_REJECTED",
      occurredAt: 101,
    });

    expect(failed).toMatchObject({
      state: "FAILED",
      failureCode: "WALLET_REJECTED",
    });
    expect(() =>
      reducePaymentEvent(failed, {
        type: "WALLET_AUTHORIZED",
        occurredAt: 102,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PaymentTransitionError>>({
        code: "INVALID_PAYMENT_TRANSITION",
      }),
    );
  });

  it("rejects skipped states, reversed timestamps, and changed tx hashes", () => {
    const created = createPaymentAttempt({
      paymentId: "payment-1",
      grantId: "grant-1",
      createdAt: 100,
    });

    expect(() =>
      reducePaymentEvent(created, {
        type: "PAYMENT_SUBMITTED",
        occurredAt: 101,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PaymentTransitionError>>({
        code: "INVALID_PAYMENT_TRANSITION",
      }),
    );
    expect(() =>
      reducePaymentEvent(created, {
        type: "WALLET_AUTHORIZED",
        occurredAt: 99,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PaymentTransitionError>>({
        code: "EVENT_TIME_REVERSED",
      }),
    );

    const pending = {
      ...created,
      state: "SETTLEMENT_PENDING" as const,
      transactionHash: TX_HASH,
    };
    expect(() =>
      reducePaymentEvent(pending, {
        type: "SETTLEMENT_VERIFIED",
        transactionHash: `0x${"bb".repeat(32)}`,
        occurredAt: 101,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<PaymentTransitionError>>({
        code: "TRANSACTION_HASH_MISMATCH",
      }),
    );
  });
});
