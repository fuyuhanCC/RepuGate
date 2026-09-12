import type {
  EvidenceClaim,
  PaymentProofVerification,
  PaymentProofVerifier,
  ReceiptUsageReader,
} from "../domain/evidence";
import type {
  AuthorizationKey,
  FeedbackRecord,
  PaymentProof,
  ReceiptKey,
} from "../domain/reputation";
import type { AgentReference, IdentitySnapshot } from "../domain/types";
import type {
  Clock,
  FeedbackReader,
  IdentityReader,
} from "../evaluation/evaluate-offer";

export interface PaymentProofFixture {
  proof: PaymentProof;
  verification: PaymentProofVerification;
}

function sameAgent(
  left: AgentReference,
  right: AgentReference,
): boolean {
  return (
    left.chainId === right.chainId &&
    left.registry.toLowerCase() === right.registry.toLowerCase() &&
    left.agentId === right.agentId
  );
}

function proofLookupKey(proof: PaymentProof): string {
  return [
    proof.chainId,
    proof.txHash.toLowerCase(),
    proof.logIndex ?? "unspecified",
  ].join(":");
}

export class FixtureIdentityReader implements IdentityReader {
  constructor(private readonly identities: readonly IdentitySnapshot[]) {}

  async resolve(reference: AgentReference): Promise<IdentitySnapshot> {
    const identity = this.identities.find((candidate) =>
      sameAgent(candidate.agent, reference),
    );

    if (identity === undefined) {
      throw new Error("Fixture identity was not found");
    }

    return identity;
  }
}

export class FixtureFeedbackReader implements FeedbackReader {
  constructor(private readonly feedback: readonly FeedbackRecord[]) {}

  async listQualityFeedback(
    reference: AgentReference,
  ): Promise<readonly FeedbackRecord[]> {
    return this.feedback.filter((record) => sameAgent(record.agent, reference));
  }
}

export class FixturePaymentProofVerifier implements PaymentProofVerifier {
  private readonly fixtures: ReadonlyMap<string, PaymentProofVerification>;

  constructor(fixtures: readonly PaymentProofFixture[]) {
    this.fixtures = new Map(
      fixtures.map((fixture) => [
        proofLookupKey(fixture.proof),
        fixture.verification,
      ]),
    );
  }

  async verify(proof: PaymentProof): Promise<PaymentProofVerification> {
    return (
      this.fixtures.get(proofLookupKey(proof)) ?? {
        status: "INVALID",
        code: "TRANSACTION_NOT_FOUND",
      }
    );
  }
}

export class FixtureReceiptUsageReader implements ReceiptUsageReader {
  constructor(
    private readonly receiptClaims: ReadonlyMap<string, EvidenceClaim> =
      new Map(),
    private readonly authorizationClaims: ReadonlyMap<
      string,
      EvidenceClaim
    > = new Map(),
  ) {}

  async findReceiptClaim(key: ReceiptKey): Promise<EvidenceClaim | null> {
    return this.receiptClaims.get(key) ?? null;
  }

  async findAuthorizationClaim(
    key: AuthorizationKey,
  ): Promise<EvidenceClaim | null> {
    return this.authorizationClaims.get(key) ?? null;
  }
}

export class FixedClock implements Clock {
  constructor(private readonly timestamp: number) {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      throw new RangeError("FixedClock timestamp must be a non-negative integer");
    }
  }

  now(): number {
    return this.timestamp;
  }
}
