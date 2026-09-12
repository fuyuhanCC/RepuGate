import { canonicalizeHttpUrl } from "../canonicalization/http-url";
import type {
  FeedbackEvaluation,
  FeedbackRejectionReason,
} from "../domain/evaluation";
import type { FeedbackRecord } from "../domain/reputation";
import type { AgentReference } from "../domain/types";
import { toQualityScoreBps } from "./fixed-point";

export interface QualityFeedbackScope {
  agent: AgentReference;
  endpoint?: string;
  tag1: string;
  tag2?: string;
}

export interface QualityFeedbackCandidate {
  feedback: FeedbackRecord;
  feedbackKey: string;
  scoreBps: number;
}

export interface QualityFeedbackFilterResult {
  candidates: QualityFeedbackCandidate[];
  rejected: FeedbackEvaluation[];
}

export function createFeedbackKey(feedback: FeedbackRecord): string {
  return [
    `eip155:${feedback.agent.chainId}`,
    feedback.agent.registry.toLowerCase(),
    feedback.agent.agentId.toString(),
    feedback.clientAddress.toLowerCase(),
    feedback.feedbackIndex.toString(),
  ].join(":");
}

function sameAgent(left: AgentReference, right: AgentReference): boolean {
  return (
    left.chainId === right.chainId &&
    left.registry.toLowerCase() === right.registry.toLowerCase() &&
    left.agentId === right.agentId
  );
}

function reject(
  feedback: FeedbackRecord,
  reason: FeedbackRejectionReason,
): FeedbackEvaluation {
  return {
    feedbackKey: createFeedbackKey(feedback),
    clientAddress: feedback.clientAddress,
    status: "REJECTED",
    reason,
  };
}

export function filterQualityFeedback(
  feedbackRecords: readonly FeedbackRecord[],
  scope: QualityFeedbackScope,
): QualityFeedbackFilterResult {
  const endpoint =
    scope.endpoint === undefined
      ? undefined
      : canonicalizeHttpUrl(scope.endpoint);
  const candidates: QualityFeedbackCandidate[] = [];
  const rejected: FeedbackEvaluation[] = [];

  for (const feedback of feedbackRecords) {
    if (!sameAgent(feedback.agent, scope.agent)) {
      rejected.push(reject(feedback, "AGENT_MISMATCH"));
      continue;
    }

    if (feedback.isRevoked) {
      rejected.push(reject(feedback, "REVOKED"));
      continue;
    }

    if (
      feedback.tag1 !== scope.tag1 ||
      (scope.tag2 !== undefined && feedback.tag2 !== scope.tag2)
    ) {
      rejected.push(reject(feedback, "TAG_MISMATCH"));
      continue;
    }

    if (endpoint !== undefined && feedback.endpoint === undefined) {
      rejected.push(reject(feedback, "ENDPOINT_MISSING"));
      continue;
    }

    if (
      endpoint !== undefined &&
      canonicalizeHttpUrl(feedback.endpoint!) !== endpoint
    ) {
      rejected.push(reject(feedback, "ENDPOINT_MISMATCH"));
      continue;
    }

    const scoreBps = toQualityScoreBps(
      feedback.value,
      feedback.valueDecimals,
    );

    if (scoreBps === null) {
      rejected.push(reject(feedback, "VALUE_OUT_OF_RANGE"));
      continue;
    }

    candidates.push({
      feedback,
      feedbackKey: createFeedbackKey(feedback),
      scoreBps,
    });
  }

  return { candidates, rejected };
}
