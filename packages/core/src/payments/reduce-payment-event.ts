import type {
  PaymentAttempt,
  PaymentEvent,
  PaymentState,
} from "../domain/payment";

export type PaymentTransitionErrorCode =
  | "EVENT_TIME_REVERSED"
  | "INVALID_PAYMENT_TRANSITION"
  | "TRANSACTION_HASH_MISMATCH";

export class PaymentTransitionError extends Error {
  constructor(
    public readonly code: PaymentTransitionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaymentTransitionError";
  }
}

const NEXT_STATE: Readonly<
  Partial<Record<PaymentState, Partial<Record<PaymentEvent["type"], PaymentState>>>>
> = {
  CREATED: {
    WALLET_AUTHORIZED: "AUTHORIZED",
    PAYMENT_FAILED: "FAILED",
  },
  AUTHORIZED: {
    PAYMENT_SUBMITTED: "SUBMITTED",
    PAYMENT_FAILED: "FAILED",
  },
  SUBMITTED: {
    SETTLEMENT_RECEIVED: "SETTLEMENT_PENDING",
    PAYMENT_FAILED: "FAILED",
  },
  SETTLEMENT_PENDING: {
    SETTLEMENT_VERIFIED: "SETTLED",
    PAYMENT_FAILED: "FAILED",
  },
};

function assertEventTime(attempt: PaymentAttempt, event: PaymentEvent): void {
  if (!Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0) {
    throw new PaymentTransitionError(
      "EVENT_TIME_REVERSED",
      "Payment event timestamp must be a non-negative integer",
    );
  }

  if (event.occurredAt < attempt.updatedAt) {
    throw new PaymentTransitionError(
      "EVENT_TIME_REVERSED",
      "Payment event predates the current payment state",
    );
  }
}

function assertMatchingTransaction(
  attempt: PaymentAttempt,
  event: PaymentEvent,
): void {
  if (!("transactionHash" in event) || attempt.transactionHash === undefined) {
    return;
  }

  if (
    attempt.transactionHash.toLowerCase() !==
    event.transactionHash.toLowerCase()
  ) {
    throw new PaymentTransitionError(
      "TRANSACTION_HASH_MISMATCH",
      "Settlement event refers to a different transaction",
    );
  }
}

export function createPaymentAttempt(input: {
  paymentId: string;
  grantId: string;
  createdAt: number;
}): PaymentAttempt {
  if (!Number.isSafeInteger(input.createdAt) || input.createdAt < 0) {
    throw new RangeError("createdAt must be a non-negative integer");
  }

  return {
    paymentId: input.paymentId,
    grantId: input.grantId,
    state: "CREATED",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

export function reducePaymentEvent(
  attempt: PaymentAttempt,
  event: PaymentEvent,
): PaymentAttempt {
  assertEventTime(attempt, event);
  assertMatchingTransaction(attempt, event);

  const nextState = NEXT_STATE[attempt.state]?.[event.type];
  if (nextState === undefined) {
    throw new PaymentTransitionError(
      "INVALID_PAYMENT_TRANSITION",
      `Cannot apply ${event.type} while payment is ${attempt.state}`,
    );
  }

  return {
    ...attempt,
    state: nextState,
    updatedAt: event.occurredAt,
    ...("transactionHash" in event
      ? { transactionHash: event.transactionHash }
      : {}),
    ...(event.type === "PAYMENT_FAILED"
      ? { failureCode: event.failureCode }
      : {}),
  };
}
