import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type {
  AuthorizedPaymentIntent,
  EvaluationGrant,
  EvaluationGrantStatus,
  PaymentAttempt,
  PaymentState,
} from "@repugate/core";
import { parseInternalJson } from "../serialization/json";

interface DecisionRow {
  id: string;
  buyer: string;
  idempotency_key: string;
  request_json: string;
  result_json: string;
  offer_json: string;
  created_at: number;
}

interface GrantRow {
  id: string;
  decision_id: string;
  offer_hash: string;
  identity_epoch: string;
  buyer: string;
  policy_hash: string;
  issued_at: number;
  expires_at: number;
  status: EvaluationGrantStatus;
}

interface PaymentRow {
  payment_id: string;
  grant_id: string;
  idempotency_key: string;
  state: PaymentState;
  intent_json: string;
  created_at: number;
  updated_at: number;
  transaction_hash: string | null;
  failure_code: string | null;
}

interface EventRow {
  event_json: string;
}

export interface StoredDecision {
  id: string;
  buyer: string;
  idempotencyKey: string;
  requestJson: string;
  resultJson: string;
  offerJson: string;
  createdAt: number;
}

export interface StoredPayment {
  attempt: PaymentAttempt;
  intent: AuthorizedPaymentIntent;
  idempotencyKey: string;
}

const SCHEMA = `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS decisions (
    id TEXT PRIMARY KEY,
    buyer TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    request_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    offer_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS evaluation_grants (
    id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL UNIQUE REFERENCES decisions(id),
    offer_hash TEXT NOT NULL,
    identity_epoch TEXT NOT NULL,
    buyer TEXT NOT NULL,
    policy_hash TEXT NOT NULL,
    issued_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ISSUED', 'CONSUMED', 'EXPIRED'))
  );

  CREATE TABLE IF NOT EXISTS payment_attempts (
    payment_id TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL UNIQUE REFERENCES evaluation_grants(id),
    idempotency_key TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (
      state IN ('CREATED', 'AUTHORIZED', 'SUBMITTED', 'SETTLEMENT_PENDING', 'SETTLED', 'FAILED')
    ),
    intent_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    transaction_hash TEXT,
    failure_code TEXT
  );

  CREATE TABLE IF NOT EXISTS payment_events (
    payment_id TEXT NOT NULL REFERENCES payment_attempts(payment_id),
    idempotency_key TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_json TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    PRIMARY KEY (payment_id, idempotency_key)
  );
`;

export class ApiDatabase {
  private readonly database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA busy_timeout = 5000");
    if (path !== ":memory:") {
      this.database.exec("PRAGMA journal_mode = WAL");
    }
    this.database.exec(SCHEMA);
  }

  close(): void {
    this.database.close();
  }

  transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");

    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  insertDecision(decision: StoredDecision): boolean {
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO decisions (
          id, buyer, idempotency_key, request_json,
          result_json, offer_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        decision.id,
        decision.buyer,
        decision.idempotencyKey,
        decision.requestJson,
        decision.resultJson,
        decision.offerJson,
        decision.createdAt,
      );

    return result.changes === 1;
  }

  findDecision(id: string): StoredDecision | null {
    const row = this.database
      .prepare("SELECT * FROM decisions WHERE id = ?")
      .get(id) as unknown as DecisionRow | undefined;

    return row === undefined
      ? null
      : {
          id: row.id,
          buyer: row.buyer,
          idempotencyKey: row.idempotency_key,
          requestJson: row.request_json,
          resultJson: row.result_json,
          offerJson: row.offer_json,
          createdAt: row.created_at,
        };
  }

  findDecisionByIdempotencyKey(key: string): StoredDecision | null {
    const row = this.database
      .prepare("SELECT * FROM decisions WHERE idempotency_key = ?")
      .get(key) as unknown as DecisionRow | undefined;

    return row === undefined
      ? null
      : {
          id: row.id,
          buyer: row.buyer,
          idempotencyKey: row.idempotency_key,
          requestJson: row.request_json,
          resultJson: row.result_json,
          offerJson: row.offer_json,
          createdAt: row.created_at,
        };
  }

  insertGrant(grant: EvaluationGrant): void {
    this.database
      .prepare(
        `INSERT INTO evaluation_grants (
          id, decision_id, offer_hash, identity_epoch, buyer,
          policy_hash, issued_at, expires_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        grant.id,
        grant.decisionId,
        grant.offerHash,
        grant.identityEpoch,
        grant.buyer,
        grant.policyHash,
        grant.issuedAt,
        grant.expiresAt,
        grant.status,
      );
  }

  findGrant(id: string): EvaluationGrant | null {
    const row = this.database
      .prepare("SELECT * FROM evaluation_grants WHERE id = ?")
      .get(id) as unknown as GrantRow | undefined;

    return row === undefined
      ? null
      : {
          id: row.id,
          decisionId: row.decision_id,
          offerHash: row.offer_hash as EvaluationGrant["offerHash"],
          identityEpoch: row.identity_epoch as EvaluationGrant["identityEpoch"],
          buyer: row.buyer as EvaluationGrant["buyer"],
          policyHash: row.policy_hash as EvaluationGrant["policyHash"],
          issuedAt: row.issued_at,
          expiresAt: row.expires_at,
          status: row.status,
        };
  }

  markGrantConsumed(id: string): boolean {
    const result = this.database
      .prepare(
        "UPDATE evaluation_grants SET status = 'CONSUMED' WHERE id = ? AND status = 'ISSUED'",
      )
      .run(id);

    return result.changes === 1;
  }

  insertPayment(input: {
    attempt: PaymentAttempt;
    intentJson: string;
    idempotencyKey: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO payment_attempts (
          payment_id, grant_id, idempotency_key, state, intent_json,
          created_at, updated_at, transaction_hash, failure_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.attempt.paymentId,
        input.attempt.grantId,
        input.idempotencyKey,
        input.attempt.state,
        input.intentJson,
        input.attempt.createdAt,
        input.attempt.updatedAt,
        input.attempt.transactionHash ?? null,
        input.attempt.failureCode ?? null,
      );
  }

  findPayment(paymentId: string): StoredPayment | null {
    const row = this.database
      .prepare("SELECT * FROM payment_attempts WHERE payment_id = ?")
      .get(paymentId) as unknown as PaymentRow | undefined;

    return row === undefined ? null : this.paymentFromRow(row);
  }

  findPaymentByIdempotencyKey(key: string): StoredPayment | null {
    const row = this.database
      .prepare("SELECT * FROM payment_attempts WHERE idempotency_key = ?")
      .get(key) as unknown as PaymentRow | undefined;

    return row === undefined ? null : this.paymentFromRow(row);
  }

  findPaymentEvent(paymentId: string, idempotencyKey: string): string | null {
    const row = this.database
      .prepare(
        `SELECT event_json FROM payment_events
         WHERE payment_id = ? AND idempotency_key = ?`,
      )
      .get(paymentId, idempotencyKey) as unknown as EventRow | undefined;

    return row?.event_json ?? null;
  }

  insertPaymentEvent(input: {
    paymentId: string;
    idempotencyKey: string;
    eventType: string;
    eventJson: string;
    occurredAt: number;
  }): void {
    this.database
      .prepare(
        `INSERT INTO payment_events (
          payment_id, idempotency_key, event_type, event_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.paymentId,
        input.idempotencyKey,
        input.eventType,
        input.eventJson,
        input.occurredAt,
      );
  }

  updatePayment(attempt: PaymentAttempt): void {
    this.database
      .prepare(
        `UPDATE payment_attempts
         SET state = ?, updated_at = ?, transaction_hash = ?, failure_code = ?
         WHERE payment_id = ?`,
      )
      .run(
        attempt.state,
        attempt.updatedAt,
        attempt.transactionHash ?? null,
        attempt.failureCode ?? null,
        attempt.paymentId,
      );
  }

  private paymentFromRow(row: PaymentRow): StoredPayment {
    return {
      attempt: {
        paymentId: row.payment_id,
        grantId: row.grant_id,
        state: row.state,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        ...(row.transaction_hash === null
          ? {}
          : {
              transactionHash:
                row.transaction_hash as PaymentAttempt["transactionHash"],
            }),
        ...(row.failure_code === null
          ? {}
          : { failureCode: row.failure_code }),
      },
      intent: parseInternalJson<AuthorizedPaymentIntent>(row.intent_json),
      idempotencyKey: row.idempotency_key,
    };
  }
}
