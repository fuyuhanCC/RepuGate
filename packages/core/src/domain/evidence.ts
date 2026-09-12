import type {
  AuthorizationKey,
  PaymentProof,
  ReceiptKey,
  ReceiptLocator,
} from "./reputation";
import type { Address, Bytes32, IdentitySnapshot } from "./types";

export type PaymentVerificationFailureCode =
  | "AMBIGUOUS_TRANSFER"
  | "AUTHORIZATION_INVALID"
  | "RPC_ERROR"
  | "TOKEN_UNSUPPORTED"
  | "TRANSACTION_FAILED"
  | "TRANSACTION_NOT_FOUND"
  | "TRANSFER_NOT_FOUND";

export interface VerifiedPaymentEvidence {
  status: "VERIFIED";
  receipt: ReceiptLocator;
  payer: Address;
  recipient: Address;
  asset: Address;
  amount: bigint;
  settledAtBlock: bigint;
  identityEpoch: Bytes32;
  authorizationNonce?: Bytes32;
}

export interface InvalidPaymentEvidence {
  status: "INVALID";
  code: PaymentVerificationFailureCode;
  detail?: string;
}

export type PaymentProofVerification =
  | VerifiedPaymentEvidence
  | InvalidPaymentEvidence;

export interface PaymentProofVerifier {
  verify(
    proof: PaymentProof,
    identity: IdentitySnapshot,
  ): Promise<PaymentProofVerification>;
}

export interface EvidenceClaim {
  feedbackKey: string;
}

export interface ReceiptUsageReader {
  findReceiptClaim(key: ReceiptKey): Promise<EvidenceClaim | null>;
  findAuthorizationClaim(key: AuthorizationKey): Promise<EvidenceClaim | null>;
}
