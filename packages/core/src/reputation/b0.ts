import type { ReputationAssessment } from "../domain/evaluation";

/**
 * Reference baseline that deliberately makes no reputation claim.
 * Offer, identity, budget, grant, and payment-path controls remain outside this
 * assessment and are therefore shared with the reputation-gated models.
 */
export function assessB0NoGate(): ReputationAssessment {
  return {
    model: "B0_NO_GATE",
    scoreBps: null,
    confidenceBps: null,
    distinctReviewerCount: 0,
    acceptedFeedback: [],
    rejectedFeedback: [],
    riskFlags: [],
  };
}
