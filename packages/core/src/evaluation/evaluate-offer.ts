import { canonicalizeOffer } from "../canonicalization/offer";
import type {
  OfferEvaluationResult,
  OfferRiskFlag,
  PolicyConfig,
  ReputationModel,
} from "../domain/evaluation";
import type {
  PaymentProofVerifier,
  ReceiptUsageReader,
} from "../domain/evidence";
import type { FeedbackRecord } from "../domain/reputation";
import type {
  AgentReference,
  Bytes32,
  IdentitySnapshot,
} from "../domain/types";
import { deriveIdentityEpoch } from "../identity/epoch";
import type { CanonicalOfferInput } from "../schemas/offer";
import { bytes32Schema } from "../schemas/offer";
import { evaluateReputation } from "./evaluate-reputation";

export interface IdentityReader {
  resolve(reference: AgentReference): Promise<IdentitySnapshot>;
}

export interface FeedbackReader {
  listQualityFeedback(
    reference: AgentReference,
  ): Promise<readonly FeedbackRecord[]>;
}

export interface Clock {
  now(): number;
}

export interface EvaluationPorts {
  identityReader: IdentityReader;
  feedbackReader: FeedbackReader;
  paymentProofVerifier: PaymentProofVerifier;
  receiptUsageReader: ReceiptUsageReader;
  clock: Clock;
}

export interface EvaluateOfferInput {
  offer: CanonicalOfferInput;
  model: ReputationModel;
  expectedOfferHash?: Bytes32;
  tag1?: string;
  tag2?: string;
  policy?: PolicyConfig;
}

function sameHex(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameAgent(
  left: AgentReference,
  right: AgentReference,
): boolean {
  return (
    left.chainId === right.chainId &&
    sameHex(left.registry, right.registry) &&
    left.agentId === right.agentId
  );
}

function deriveVerifiedIdentity(
  resolved: IdentitySnapshot,
): IdentitySnapshot {
  return deriveIdentityEpoch({
    agent: {
      chainId: resolved.agent.chainId,
      registry: resolved.agent.registry,
      agentId: resolved.agent.agentId.toString(),
    },
    owner: resolved.owner,
    agentWallet: resolved.agentWallet,
    registeredEndpoint: resolved.registeredEndpoint,
    agentUriHash: resolved.agentUriHash,
    observedAtBlock: resolved.observedAtBlock.toString(),
  });
}

function isResourceWithinEndpoint(
  resourceUrl: string,
  registeredEndpoint: string,
): boolean {
  const resource = new URL(resourceUrl);
  const endpoint = new URL(registeredEndpoint);

  if (resource.origin !== endpoint.origin) {
    return false;
  }

  if (endpoint.search !== "") {
    return (
      resource.pathname === endpoint.pathname &&
      resource.search === endpoint.search
    );
  }

  const endpointPrefix = endpoint.pathname.endsWith("/")
    ? endpoint.pathname
    : `${endpoint.pathname}/`;

  return (
    resource.pathname === endpoint.pathname ||
    resource.pathname.startsWith(endpointPrefix)
  );
}

function collectOfferRiskFlags(input: {
  offerHash: Bytes32;
  expectedOfferHash?: Bytes32;
  offerAgent: AgentReference;
  payTo: string;
  endpointHash: Bytes32;
  resourceUrl: string;
  identity: IdentitySnapshot;
}): OfferRiskFlag[] {
  const flags: OfferRiskFlag[] = [];

  if (!sameAgent(input.offerAgent, input.identity.agent)) {
    flags.push("AGENT_REFERENCE_MISMATCH");
  }
  if (!sameHex(input.endpointHash, input.identity.endpointHash)) {
    flags.push("ENDPOINT_HASH_MISMATCH");
  }
  if (
    input.expectedOfferHash !== undefined &&
    !sameHex(input.offerHash, input.expectedOfferHash)
  ) {
    flags.push("OFFER_HASH_MISMATCH");
  }
  if (!sameHex(input.payTo, input.identity.agentWallet)) {
    flags.push("PAY_TO_MISMATCH");
  }
  if (
    !isResourceWithinEndpoint(
      input.resourceUrl,
      input.identity.registeredEndpoint,
    )
  ) {
    flags.push("RESOURCE_ENDPOINT_MISMATCH");
  }

  return flags;
}

function readEvaluationTime(clock: Clock): number {
  const evaluatedAt = clock.now();

  if (!Number.isSafeInteger(evaluatedAt) || evaluatedAt < 0) {
    throw new RangeError("Clock must return a non-negative integer timestamp");
  }

  return evaluatedAt;
}

export async function evaluateOffer(
  input: EvaluateOfferInput,
  ports: EvaluationPorts,
): Promise<OfferEvaluationResult> {
  const canonicalized = canonicalizeOffer(input.offer);
  const expectedOfferHash =
    input.expectedOfferHash === undefined
      ? undefined
      : (bytes32Schema.parse(input.expectedOfferHash).toLowerCase() as Bytes32);
  const resolvedIdentity = await ports.identityReader.resolve(
    canonicalized.offer.agent,
  );
  const identity = deriveVerifiedIdentity(resolvedIdentity);
  const identityMatched =
    sameAgent(canonicalized.offer.agent, identity.agent) &&
    sameHex(resolvedIdentity.identityEpoch, identity.identityEpoch);
  const offerRiskFlags = collectOfferRiskFlags({
    offerHash: canonicalized.offerHash,
    expectedOfferHash,
    offerAgent: canonicalized.offer.agent,
    payTo: canonicalized.offer.payTo,
    endpointHash: canonicalized.offer.endpointHash,
    resourceUrl: canonicalized.offer.resourceUrl,
    identity,
  });
  const feedback = await ports.feedbackReader.listQualityFeedback(
    canonicalized.offer.agent,
  );
  const reputationInput = {
    feedback,
    identity,
    tag1: input.tag1,
    tag2: input.tag2,
    policy: input.policy,
    identityMatched,
    offerRiskFlags,
  };
  const reputation =
    input.model === "B1_RAW"
      ? await evaluateReputation({
          ...reputationInput,
          model: "B1_RAW",
        })
      : await evaluateReputation({
          ...reputationInput,
          model: input.model,
          paymentProofVerifier: ports.paymentProofVerifier,
          receiptUsageReader: ports.receiptUsageReader,
        });

  return {
    ...reputation,
    canonicalOffer: canonicalized.offer,
    offerHash: canonicalized.offerHash,
    identity,
    identityMatched,
    offerRiskFlags,
    evaluatedAt: readEvaluationTime(ports.clock),
  };
}
