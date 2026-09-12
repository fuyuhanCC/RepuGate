import type { Address, Bytes32, CanonicalOffer } from "./types";

export type EvaluationGrantStatus = "ISSUED" | "CONSUMED" | "EXPIRED";

export interface EvaluationGrant {
  id: string;
  decisionId: string;
  offerHash: Bytes32;
  identityEpoch: Bytes32;
  buyer: Address;
  policyHash: Bytes32;
  issuedAt: number;
  expiresAt: number;
  status: EvaluationGrantStatus;
}

export interface GrantConsumptionBinding {
  buyer: Address;
  offerHash: Bytes32;
  identityEpoch: Bytes32;
  policyHash: Bytes32;
}

export interface AuthorizedPaymentIntent {
  paymentId: string;
  grantId: string;
  buyer: Address;
  offerHash: Bytes32;
  identityEpoch: Bytes32;
  policyHash: Bytes32;
  offer: CanonicalOffer;
}
