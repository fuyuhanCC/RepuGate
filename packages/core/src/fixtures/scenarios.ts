import { canonicalizeOffer } from "../canonicalization/offer";
import type { PaymentProofFixture } from "./adapters";
import type { VerifiedPaymentEvidence } from "../domain/evidence";
import type { FeedbackRecord, PaymentProof } from "../domain/reputation";
import type { Address, Bytes32, IdentitySnapshot } from "../domain/types";
import type {
  EvaluateOfferInput,
  EvaluationPorts,
} from "../evaluation/evaluate-offer";
import { deriveIdentityEpoch } from "../identity/epoch";
import type { CanonicalOfferInput } from "../schemas/offer";
import {
  FixedClock,
  FixtureFeedbackReader,
  FixtureIdentityReader,
  FixturePaymentProofVerifier,
  FixtureReceiptUsageReader,
} from "./adapters";

export type DeterministicScenarioId =
  | "honest-service"
  | "offer-substitution"
  | "receipt-replay"
  | "ungrounded-feedback";

export interface DeterministicScenarioContext {
  id: DeterministicScenarioId;
  title: string;
  description: string;
  input: EvaluateOfferInput;
  ports: EvaluationPorts;
}

interface ScenarioData {
  title: string;
  description: string;
  identity: IdentitySnapshot;
  offer: CanonicalOfferInput;
  feedback: FeedbackRecord[];
  paymentFixtures: PaymentProofFixture[];
  expectedOfferHash?: Bytes32;
}

const REGISTRY =
  "0x8004a818bfb912233c491871b3d84c89a494bd9e" as Address;
const AGENT_WALLET =
  "0x209693bc6afc0c5328ba36faf03c514ef312287c" as Address;
const ASSET =
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as Address;
const ENDPOINT = "https://provider.example/services/honest";
const ZERO_HASH = `0x${"00".repeat(32)}` as Bytes32;
const FIXED_TIME = 1_700_000_000;
const REVIEWERS = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
  "0x4444444444444444444444444444444444444444",
  "0x5555555555555555555555555555555555555555",
] as const satisfies readonly Address[];

function bytes32(byte: string): Bytes32 {
  return `0x${byte.repeat(64)}` as Bytes32;
}

function buildIdentity(): IdentitySnapshot {
  return deriveIdentityEpoch({
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
}

function buildOffer(identity: IdentitySnapshot): CanonicalOfferInput {
  return {
    method: "POST",
    resourceUrl: `${ENDPOINT}/inference`,
    endpointHash: identity.endpointHash,
    requestBodyHash: bytes32("f"),
    scheme: "exact",
    network: "eip155:84532",
    asset: ASSET,
    amount: "10000",
    payTo: identity.agentWallet,
    maxTimeoutSeconds: 60,
    agent: {
      chainId: identity.agent.chainId,
      registry: identity.agent.registry,
      agentId: identity.agent.agentId.toString(),
    },
  };
}

function buildProof(
  identity: IdentitySnapshot,
  reviewer: Address,
  index: number,
): PaymentProof {
  return {
    chainId: identity.agent.chainId,
    txHash: bytes32(String(index)),
    fromAddress: reviewer,
    toAddress: identity.agentWallet,
    logIndex: index,
    authorizationNonce: bytes32(String(index + 5)),
  };
}

function buildVerification(
  identity: IdentitySnapshot,
  proof: PaymentProof,
): VerifiedPaymentEvidence {
  return {
    status: "VERIFIED",
    receipt: {
      chainId: proof.chainId,
      txHash: proof.txHash,
      logIndex: proof.logIndex!,
    },
    payer: proof.fromAddress,
    recipient: proof.toAddress,
    asset: ASSET,
    amount: 10_000n,
    settledAtBlock: 100n,
    identityEpoch: identity.identityEpoch,
    authorizationNonce: proof.authorizationNonce,
  };
}

function buildFeedback(input: {
  identity: IdentitySnapshot;
  reviewer: Address;
  index: number;
  score: number;
  proof?: PaymentProof;
}): FeedbackRecord {
  return {
    agent: input.identity.agent,
    clientAddress: input.reviewer,
    feedbackIndex: BigInt(input.index),
    value: BigInt(input.score),
    valueDecimals: 0,
    tag1: "quality",
    tag2: "inference",
    endpoint: input.identity.registeredEndpoint,
    isRevoked: false,
    observedAtBlock: BigInt(100 + input.index),
    ...(input.proof === undefined ? {} : { proofOfPayment: input.proof }),
  };
}

function honestData(): ScenarioData {
  const identity = buildIdentity();
  const offer = buildOffer(identity);
  const scores = [80, 90, 100];
  const feedback: FeedbackRecord[] = [];
  const paymentFixtures: PaymentProofFixture[] = [];

  for (const [offset, score] of scores.entries()) {
    const index = offset + 1;
    const proof = buildProof(identity, REVIEWERS[offset], index);
    feedback.push(
      buildFeedback({
        identity,
        reviewer: REVIEWERS[offset],
        index,
        score,
        proof,
      }),
    );
    paymentFixtures.push({
      proof,
      verification: buildVerification(identity, proof),
    });
  }

  return {
    title: "Honest paid service",
    description: "Three independent reviewers provide payment-grounded feedback.",
    identity,
    offer,
    feedback,
    paymentFixtures,
  };
}

function ungroundedFeedbackData(): ScenarioData {
  const identity = buildIdentity();

  return {
    title: "Ungrounded feedback attack",
    description: "Five high ratings have no verifiable service payment.",
    identity,
    offer: buildOffer(identity),
    feedback: REVIEWERS.map((reviewer, offset) =>
      buildFeedback({
        identity,
        reviewer,
        index: offset + 1,
        score: 100,
      }),
    ),
    paymentFixtures: [],
  };
}

function receiptReplayData(): ScenarioData {
  const identity = buildIdentity();
  const proof = buildProof(identity, REVIEWERS[0], 1);

  return {
    title: "Receipt replay attack",
    description: "One paid interaction is attached to five feedback records.",
    identity,
    offer: buildOffer(identity),
    feedback: [10, 100, 100, 100, 100].map((score, offset) =>
      buildFeedback({
        identity,
        reviewer: REVIEWERS[0],
        index: offset + 1,
        score,
        proof,
      }),
    ),
    paymentFixtures: [
      { proof, verification: buildVerification(identity, proof) },
    ],
  };
}

function offerSubstitutionData(): ScenarioData {
  const data = honestData();
  const expectedOfferHash = canonicalizeOffer(data.offer).offerHash;

  return {
    ...data,
    title: "Offer substitution attack",
    description: "The amount changes after the buyer evaluates the exact offer.",
    offer: { ...data.offer, amount: "20000" },
    expectedOfferHash,
  };
}

function buildScenarioData(id: DeterministicScenarioId): ScenarioData {
  switch (id) {
    case "honest-service":
      return honestData();
    case "offer-substitution":
      return offerSubstitutionData();
    case "receipt-replay":
      return receiptReplayData();
    case "ungrounded-feedback":
      return ungroundedFeedbackData();
  }
}

export const DETERMINISTIC_SCENARIO_IDS = [
  "honest-service",
  "ungrounded-feedback",
  "receipt-replay",
  "offer-substitution",
] as const satisfies readonly DeterministicScenarioId[];

export function createDeterministicScenario(
  id: DeterministicScenarioId,
  model: EvaluateOfferInput["model"],
): DeterministicScenarioContext {
  const data = buildScenarioData(id);

  return {
    id,
    title: data.title,
    description: data.description,
    input: {
      offer: data.offer,
      model,
      expectedOfferHash: data.expectedOfferHash,
      tag2: "inference",
    },
    ports: {
      identityReader: new FixtureIdentityReader([data.identity]),
      feedbackReader: new FixtureFeedbackReader(data.feedback),
      paymentProofVerifier: new FixturePaymentProofVerifier(
        data.paymentFixtures,
      ),
      receiptUsageReader: new FixtureReceiptUsageReader(),
      clock: new FixedClock(FIXED_TIME),
    },
  };
}
