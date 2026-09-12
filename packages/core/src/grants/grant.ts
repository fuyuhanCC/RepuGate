import type { OfferEvaluationResult } from "../domain/evaluation";
import type {
  EvaluationGrant,
  GrantConsumptionBinding,
} from "../domain/grant";
import type { Address } from "../domain/types";

export type GrantErrorCode =
  | "GRANT_ALREADY_CONSUMED"
  | "GRANT_BUYER_MISMATCH"
  | "GRANT_EXPIRED"
  | "GRANT_IDENTITY_MISMATCH"
  | "GRANT_NOT_ALLOWED"
  | "GRANT_OFFER_MISMATCH"
  | "GRANT_POLICY_MISMATCH"
  | "INVALID_GRANT_LIFETIME";

export class GrantError extends Error {
  constructor(
    public readonly code: GrantErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GrantError";
  }
}

export interface IssueEvaluationGrantInput {
  id: string;
  decisionId: string;
  buyer: Address;
  evaluation: OfferEvaluationResult;
  issuedAt: number;
  lifetimeSeconds: number;
}

function assertTimestamp(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GrantError(
      "INVALID_GRANT_LIFETIME",
      `${name} must be a non-negative integer`,
    );
  }
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function issueEvaluationGrant(
  input: IssueEvaluationGrantInput,
): EvaluationGrant {
  if (input.evaluation.decision !== "ALLOW") {
    throw new GrantError(
      "GRANT_NOT_ALLOWED",
      "Only an ALLOW decision can issue an evaluation grant",
    );
  }

  assertTimestamp("issuedAt", input.issuedAt);
  if (
    !Number.isSafeInteger(input.lifetimeSeconds) ||
    input.lifetimeSeconds <= 0
  ) {
    throw new GrantError(
      "INVALID_GRANT_LIFETIME",
      "Grant lifetime must be a positive integer",
    );
  }

  const expiresAt = input.issuedAt + input.lifetimeSeconds;
  assertTimestamp("expiresAt", expiresAt);

  return {
    id: input.id,
    decisionId: input.decisionId,
    offerHash: input.evaluation.offerHash,
    identityEpoch: input.evaluation.identity.identityEpoch,
    buyer: input.buyer,
    policyHash: input.evaluation.policyHash,
    issuedAt: input.issuedAt,
    expiresAt,
    status: "ISSUED",
  };
}

export function assertGrantConsumable(
  grant: EvaluationGrant,
  binding: GrantConsumptionBinding,
  now: number,
): void {
  assertTimestamp("now", now);

  if (grant.status === "CONSUMED") {
    throw new GrantError(
      "GRANT_ALREADY_CONSUMED",
      "Evaluation grant has already been consumed",
    );
  }
  if (grant.status === "EXPIRED") {
    throw new GrantError("GRANT_EXPIRED", "Evaluation grant has expired");
  }
  if (now >= grant.expiresAt) {
    throw new GrantError("GRANT_EXPIRED", "Evaluation grant has expired");
  }

  assertGrantBindingMatches(grant, binding);
}

export function assertGrantBindingMatches(
  grant: EvaluationGrant,
  binding: GrantConsumptionBinding,
): void {
  if (!sameHex(grant.buyer, binding.buyer)) {
    throw new GrantError(
      "GRANT_BUYER_MISMATCH",
      "Grant belongs to a different buyer",
    );
  }
  if (!sameHex(grant.offerHash, binding.offerHash)) {
    throw new GrantError(
      "GRANT_OFFER_MISMATCH",
      "Offer hash does not match the evaluated offer",
    );
  }
  if (!sameHex(grant.identityEpoch, binding.identityEpoch)) {
    throw new GrantError(
      "GRANT_IDENTITY_MISMATCH",
      "Identity epoch has changed since evaluation",
    );
  }
  if (!sameHex(grant.policyHash, binding.policyHash)) {
    throw new GrantError(
      "GRANT_POLICY_MISMATCH",
      "Policy hash does not match the evaluated policy",
    );
  }
}
