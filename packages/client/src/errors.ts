export type TrustedFetchErrorCode =
  | "AUTHORIZED_INTENT_MISMATCH"
  | "EVALUATION_BINDING_MISMATCH"
  | "GRANT_BINDING_MISMATCH"
  | "INVALID_PAYMENT_REQUIRED"
  | "INVALID_SETTLEMENT_RESPONSE"
  | "MISSING_AGENT_EXTENSION"
  | "MISSING_PAYMENT_REQUIRED"
  | "NO_ACCEPTABLE_OFFER"
  | "PAYMENT_REJECTED"
  | "PAYMENT_SUBMISSION_UNCERTAIN"
  | "REDIRECT_BLOCKED"
  | "RESOURCE_MISMATCH"
  | "UNSUPPORTED_REQUEST_BODY"
  | "WALLET_AUTHORIZATION_INVALID"
  | "WALLET_AUTHORIZATION_REJECTED"
  | "WALLET_CHAIN_MISMATCH";

export class TrustedFetchError extends Error {
  constructor(
    public readonly code: TrustedFetchErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TrustedFetchError";
  }
}
