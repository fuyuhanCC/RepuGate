import { deriveIdentityEpoch } from "../identity/epoch";
import type {
  PaymentProofVerification,
  PaymentProofVerifier,
  VerifiedPaymentEvidence,
} from "../domain/evidence";
import type { FeedbackRecord, PaymentProof } from "../domain/reputation";
import type { Address, Bytes32, IdentitySnapshot } from "../domain/types";

export const REGISTRY =
  "0x8004a818bfb912233c491871b3d84c89a494bd9e" as Address;
export const AGENT_WALLET =
  "0x209693bc6afc0c5328ba36faf03c514ef312287c" as Address;
export const ASSET =
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Address;
export const ENDPOINT = "https://provider.example/services/honest";

export const REVIEWERS = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
  "0x4444444444444444444444444444444444444444",
  "0x5555555555555555555555555555555555555555",
] as const satisfies readonly Address[];

const ZERO_HASH = `0x${"00".repeat(32)}` as Bytes32;

export const IDENTITY: IdentitySnapshot = deriveIdentityEpoch({
  agent: {
    chainId: 84_532,
    registry: REGISTRY,
    agentId: "12",
  },
  owner: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  agentWallet: AGENT_WALLET,
  registeredEndpoint: ENDPOINT,
  agentUriHash: ZERO_HASH,
  observedAtBlock: "100",
});

export function bytes32(byte: string): Bytes32 {
  return `0x${byte.repeat(64)}` as Bytes32;
}

export function makePaymentProof(input: {
  clientAddress: Address;
  txHash: Bytes32;
  recipient?: Address;
  logIndex?: number;
  authorizationNonce?: Bytes32;
}): PaymentProof {
  return {
    chainId: 84_532,
    txHash: input.txHash,
    fromAddress: input.clientAddress,
    toAddress: input.recipient ?? AGENT_WALLET,
    logIndex: input.logIndex ?? 0,
    ...(input.authorizationNonce === undefined
      ? {}
      : { authorizationNonce: input.authorizationNonce }),
  };
}

export function makeFeedback(
  overrides: Partial<FeedbackRecord> = {},
): FeedbackRecord {
  return {
    agent: IDENTITY.agent,
    clientAddress: REVIEWERS[0],
    feedbackIndex: 1n,
    value: 80n,
    valueDecimals: 0,
    tag1: "quality",
    tag2: "inference",
    endpoint: ENDPOINT,
    isRevoked: false,
    observedAtBlock: 101n,
    ...overrides,
  };
}

export function verifiedEvidence(
  proof: PaymentProof,
  overrides: Partial<VerifiedPaymentEvidence> = {},
): VerifiedPaymentEvidence {
  return {
    status: "VERIFIED",
    receipt: {
      chainId: proof.chainId,
      txHash: proof.txHash,
      logIndex: proof.logIndex ?? 0,
    },
    payer: proof.fromAddress,
    recipient: proof.toAddress,
    asset: ASSET,
    amount: 10_000n,
    settledAtBlock: 100n,
    identityEpoch: IDENTITY.identityEpoch,
    ...(proof.authorizationNonce === undefined
      ? {}
      : { authorizationNonce: proof.authorizationNonce }),
    ...overrides,
  };
}

export class MapPaymentProofVerifier implements PaymentProofVerifier {
  readonly calls: PaymentProof[] = [];

  constructor(
    private readonly verifications: ReadonlyMap<
      string,
      PaymentProofVerification
    >,
  ) {}

  async verify(proof: PaymentProof): Promise<PaymentProofVerification> {
    this.calls.push(proof);
    const verification = this.verifications.get(proof.txHash.toLowerCase());

    if (verification === undefined) {
      return { status: "INVALID", code: "TRANSACTION_NOT_FOUND" };
    }

    return verification;
  }
}
