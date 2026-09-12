import { getAddress } from "viem";

import { canonicalizeHttpUrl } from "../canonicalization/http-url";
import type { FeedbackRecord, PaymentProof } from "../domain/reputation";
import type { Bytes32 } from "../domain/types";
import {
  feedbackRecordInputSchema,
  type FeedbackRecordInput,
  type ParsedFeedbackRecordInput,
} from "../schemas/feedback";

const ZERO_BYTES_32 = `0x${"0".repeat(64)}`;

function normalizeOptionalText(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function normalizeOptionalHash(value: string | undefined): Bytes32 | undefined {
  if (value === undefined || value.toLowerCase() === ZERO_BYTES_32) {
    return undefined;
  }

  return value.toLowerCase() as Bytes32;
}

function normalizeFeedbackUri(value: string | undefined): string | undefined {
  const nonEmpty = normalizeOptionalText(value);

  if (nonEmpty === undefined || nonEmpty.startsWith("ipfs://")) {
    return nonEmpty;
  }

  return canonicalizeHttpUrl(nonEmpty);
}

function normalizePaymentProof(
  proof: ParsedFeedbackRecordInput["proofOfPayment"],
): PaymentProof | undefined {
  if (proof === undefined) {
    return undefined;
  }

  return {
    chainId: Number(proof.chainId),
    txHash: proof.txHash.toLowerCase() as Bytes32,
    fromAddress: getAddress(proof.fromAddress),
    toAddress: getAddress(proof.toAddress),
    ...(proof.logIndex === undefined ? {} : { logIndex: proof.logIndex }),
    ...(proof.authorizationNonce === undefined
      ? {}
      : {
          authorizationNonce: proof.authorizationNonce.toLowerCase() as Bytes32,
        }),
  };
}

export function normalizeFeedbackRecord(
  input: FeedbackRecordInput,
): FeedbackRecord {
  const parsed = feedbackRecordInputSchema.parse(input);
  const endpoint = normalizeOptionalText(parsed.endpoint);
  const feedbackUri = normalizeFeedbackUri(parsed.feedbackUri);
  const feedbackHash = normalizeOptionalHash(parsed.feedbackHash);
  const proofOfPayment = normalizePaymentProof(parsed.proofOfPayment);

  return {
    agent: {
      chainId: parsed.agent.chainId,
      registry: getAddress(parsed.agent.registry),
      agentId: BigInt(parsed.agent.agentId),
    },
    clientAddress: getAddress(parsed.clientAddress),
    feedbackIndex: BigInt(parsed.feedbackIndex),
    value: BigInt(parsed.value),
    valueDecimals: parsed.valueDecimals,
    tag1: parsed.tag1,
    tag2: parsed.tag2,
    ...(endpoint === undefined
      ? {}
      : { endpoint: canonicalizeHttpUrl(endpoint) }),
    ...(feedbackUri === undefined ? {} : { feedbackUri }),
    ...(feedbackHash === undefined ? {} : { feedbackHash }),
    isRevoked: parsed.isRevoked,
    observedAtBlock: BigInt(parsed.observedAtBlock),
    ...(proofOfPayment === undefined ? {} : { proofOfPayment }),
  };
}
