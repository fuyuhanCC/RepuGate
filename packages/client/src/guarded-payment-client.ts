import type {
  Address,
  AuthorizedPaymentIntent,
  CanonicalOffer,
  CanonicalizedOffer,
  EvaluationGrant,
  OfferEvaluationResult,
  PaymentAttempt,
} from "@repugate/core";
import {
  canonicalizeOffer,
  evmAddressSchema,
} from "@repugate/core";

import { TrustedFetchError } from "./errors";
import type {
  EvaluationApiPort,
  EvaluationResponse,
  IdempotencyKeyGenerator,
  WalletPort,
} from "./ports";
import {
  signedEvmAuthorizationSchema,
  type SignedEvmAuthorization,
} from "./x402/schemas";

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHash(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function hashCanonicalOffer(offer: CanonicalOffer): string {
  return canonicalizeOffer({
    ...offer,
    amount: offer.amount.toString(),
    agent: {
      ...offer.agent,
      agentId: offer.agent.agentId.toString(),
    },
  }).offerHash;
}

function assertEvaluationBinding(
  result: EvaluationResponse,
  local: CanonicalizedOffer,
): EvaluationGrant {
  const { evaluation, grant } = result;

  if (
    evaluation.decision !== "ALLOW" ||
    grant === null ||
    !evaluation.identityMatched ||
    !sameHash(evaluation.offerHash, local.offerHash) ||
    !sameHash(hashCanonicalOffer(evaluation.canonicalOffer), local.offerHash)
  ) {
    throw new TrustedFetchError(
      "EVALUATION_BINDING_MISMATCH",
      "The ALLOW evaluation is not bound to the exact locally selected offer",
    );
  }

  if (
    grant.status !== "ISSUED" ||
    grant.decisionId !== result.decisionId ||
    !sameHash(grant.offerHash, evaluation.offerHash) ||
    !sameHash(grant.identityEpoch, evaluation.identity.identityEpoch) ||
    !sameHash(grant.policyHash, evaluation.policyHash)
  ) {
    throw new TrustedFetchError(
      "GRANT_BINDING_MISMATCH",
      "The evaluation Grant does not match the ALLOW decision",
    );
  }

  return grant;
}

function assertAuthorizedIntent(
  intent: AuthorizedPaymentIntent,
  attempt: PaymentAttempt,
  grant: EvaluationGrant,
  buyer: Address,
  local: CanonicalizedOffer,
): void {
  if (
    attempt.state !== "CREATED" ||
    attempt.paymentId !== intent.paymentId ||
    attempt.grantId !== grant.id ||
    intent.grantId !== grant.id ||
    !sameAddress(intent.buyer, buyer) ||
    !sameHash(intent.offerHash, local.offerHash) ||
    !sameHash(intent.identityEpoch, grant.identityEpoch) ||
    !sameHash(intent.policyHash, grant.policyHash) ||
    !sameHash(hashCanonicalOffer(intent.offer), local.offerHash)
  ) {
    throw new TrustedFetchError(
      "AUTHORIZED_INTENT_MISMATCH",
      "The API payment intent does not match the consumed Grant and exact offer",
    );
  }
}

function assertSignedAuthorization(
  value: SignedEvmAuthorization,
  buyer: Address,
  intent: AuthorizedPaymentIntent,
): SignedEvmAuthorization {
  const parsed = signedEvmAuthorizationSchema.safeParse(value);
  if (!parsed.success) {
    throw new TrustedFetchError(
      "WALLET_AUTHORIZATION_INVALID",
      "The wallet returned an invalid exact-EVM authorization payload",
      { cause: parsed.error },
    );
  }

  const { authorization } = parsed.data;
  if (
    !sameAddress(authorization.from, buyer) ||
    !sameAddress(authorization.to, intent.offer.payTo) ||
    BigInt(authorization.value) !== intent.offer.amount ||
    BigInt(authorization.validBefore) <= BigInt(authorization.validAfter)
  ) {
    throw new TrustedFetchError(
      "WALLET_AUTHORIZATION_INVALID",
      "The signed authorization changes the evaluated payer, recipient, amount, or time window",
    );
  }

  return parsed.data;
}

export interface PreparedPayment {
  paymentId: string;
  intent: AuthorizedPaymentIntent;
  signedAuthorization: SignedEvmAuthorization;
}

export class GuardedPaymentClient {
  constructor(
    private readonly api: EvaluationApiPort,
    private readonly wallet: WalletPort,
    private readonly keys: IdempotencyKeyGenerator,
  ) {}

  async prepare(input: {
    buyer: Address;
    localOffer: CanonicalizedOffer;
    evaluation: EvaluationResponse;
  }): Promise<PreparedPayment> {
    const buyer = evmAddressSchema.parse(input.buyer) as Address;
    const grant = assertEvaluationBinding(input.evaluation, input.localOffer);

    if (!sameAddress(grant.buyer, buyer)) {
      throw new TrustedFetchError(
        "GRANT_BINDING_MISMATCH",
        "The evaluation Grant belongs to a different buyer",
      );
    }

    const consumed = await this.api.consumeGrant({
      grantId: grant.id,
      buyer,
      offerHash: grant.offerHash,
      identityEpoch: grant.identityEpoch,
      policyHash: grant.policyHash,
      idempotencyKey: this.keys.next("consume"),
    });
    assertAuthorizedIntent(
      consumed.authorizedIntent,
      consumed.payment,
      grant,
      buyer,
      input.localOffer,
    );

    const walletChainId = await this.wallet.getChainId();
    if (walletChainId !== consumed.authorizedIntent.offer.agent.chainId) {
      await this.recordFailureBestEffort(
        consumed.payment.paymentId,
        "WALLET_CHAIN_MISMATCH",
      );
      throw new TrustedFetchError(
        "WALLET_CHAIN_MISMATCH",
        `Wallet chain ${walletChainId} does not match evaluated chain ${consumed.authorizedIntent.offer.agent.chainId}`,
      );
    }

    let signedAuthorization: SignedEvmAuthorization;
    try {
      signedAuthorization = assertSignedAuthorization(
        await this.wallet.signX402Authorization(consumed.authorizedIntent),
        buyer,
        consumed.authorizedIntent,
      );
    } catch (error) {
      await this.recordFailureBestEffort(
        consumed.payment.paymentId,
        "WALLET_AUTHORIZATION_REJECTED",
      );
      if (error instanceof TrustedFetchError) {
        throw error;
      }
      throw new TrustedFetchError(
        "WALLET_AUTHORIZATION_REJECTED",
        "The wallet did not produce a payment authorization",
        { cause: error },
      );
    }

    await this.api.recordPaymentEvent(consumed.payment.paymentId, {
      eventType: "WALLET_AUTHORIZED",
      idempotencyKey: this.keys.next("payment-event"),
    });

    return {
      paymentId: consumed.payment.paymentId,
      intent: consumed.authorizedIntent,
      signedAuthorization,
    };
  }

  async markSubmitted(paymentId: string): Promise<void> {
    await this.api.recordPaymentEvent(paymentId, {
      eventType: "PAYMENT_SUBMITTED",
      idempotencyKey: this.keys.next("payment-event"),
    });
  }

  async markSettlementReceived(
    paymentId: string,
    transactionHash: `0x${string}`,
  ): Promise<void> {
    await this.api.recordPaymentEvent(paymentId, {
      eventType: "SETTLEMENT_RECEIVED",
      transactionHash,
      idempotencyKey: this.keys.next("payment-event"),
    });
  }

  async markFailed(paymentId: string, failureCode: string): Promise<void> {
    await this.api.recordPaymentEvent(paymentId, {
      eventType: "PAYMENT_FAILED",
      failureCode,
      idempotencyKey: this.keys.next("payment-event"),
    });
  }

  private async recordFailureBestEffort(
    paymentId: string,
    failureCode: string,
  ): Promise<void> {
    try {
      await this.markFailed(paymentId, failureCode);
    } catch {
      // Preserve the wallet/security error; server reconciliation can repair state.
    }
  }
}

export function isDeniedEvaluation(
  evaluation: OfferEvaluationResult,
): evaluation is OfferEvaluationResult & { decision: "BLOCK" | "REVIEW" } {
  return evaluation.decision === "BLOCK" || evaluation.decision === "REVIEW";
}
