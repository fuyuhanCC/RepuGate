import type {
  Address,
  Bytes32,
  CanonicalOffer,
  IdentitySnapshot,
} from "./types";

export type ReputationModel =
  | "B1_RAW"
  | "B2_GROUNDED"
  | "B3_REPUGATE"
  | "B3_DIRICHLET";

export type Decision = "ALLOW" | "REVIEW" | "BLOCK";

export type FeedbackRejectionReason =
  | "AGENT_MISMATCH"
  | "ENDPOINT_MISMATCH"
  | "ENDPOINT_MISSING"
  | "INVALID_PAYMENT"
  | "IDENTITY_EPOCH_MISMATCH"
  | "MISSING_PAYMENT_PROOF"
  | "PAYMENT_AFTER_FEEDBACK"
  | "PAYER_MISMATCH"
  | "PAYMENT_PROOF_MISMATCH"
  | "RECEIPT_REPLAY"
  | "RECIPIENT_MISMATCH"
  | "REVOKED"
  | "TAG_MISMATCH"
  | "VALUE_OUT_OF_RANGE";

export type ReputationRiskFlag =
  | "INVALID_PAYMENT_PRESENT"
  | "LOW_DISTINCT_REVIEWER_COUNT"
  | "NO_ELIGIBLE_FEEDBACK"
  | "NO_VERIFIED_FEEDBACK"
  | "REPLAY_ATTEMPT_PRESENT"
  | "UNGROUNDED_FEEDBACK_PRESENT";

export type OfferRiskFlag =
  | "AGENT_REFERENCE_MISMATCH"
  | "ENDPOINT_HASH_MISMATCH"
  | "OFFER_HASH_MISMATCH"
  | "PAY_TO_MISMATCH"
  | "RESOURCE_ENDPOINT_MISMATCH";

export interface FeedbackEvaluation {
  feedbackKey: string;
  clientAddress: Address;
  status: "ACCEPTED" | "REJECTED";
  scoreBps?: number;
  reason?: FeedbackRejectionReason;
  detail?: string;
  receiptKey?: string;
  authorizationKey?: string;
}

export interface ReputationAssessment {
  model: ReputationModel;
  scoreBps: number | null;
  confidenceBps: number;
  distinctReviewerCount: number;
  acceptedFeedback: FeedbackEvaluation[];
  rejectedFeedback: FeedbackEvaluation[];
  riskFlags: ReputationRiskFlag[];
}

export interface PolicyConfig {
  version: string;
  allowScoreBps: number;
  allowConfidenceBps: number;
  reviewScoreBps: number;
}

export interface PolicyDecision {
  decision: Decision;
  reasons: string[];
  policyHash: Bytes32;
}

export interface ReputationEvaluationResult {
  model: ReputationModel;
  rawScoreBps: number | null;
  verifiedScoreBps: number | null;
  confidenceBps: number;
  distinctReviewerCount: number;
  acceptedFeedback: FeedbackEvaluation[];
  rejectedFeedback: FeedbackEvaluation[];
  riskFlags: ReputationRiskFlag[];
  decision: Decision;
  decisionReasons: string[];
  policyHash: Bytes32;
}

export interface OfferEvaluationResult extends ReputationEvaluationResult {
  canonicalOffer: CanonicalOffer;
  offerHash: Bytes32;
  identity: IdentitySnapshot;
  identityMatched: boolean;
  offerRiskFlags: OfferRiskFlag[];
  evaluatedAt: number;
}
