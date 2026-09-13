import type { FeedbackEvaluation } from "../domain/evaluation";
import { averageScoreBps } from "./fixed-point";

/**
 * Collapses all accepted records from one address into one reviewer-level score.
 * A reviewer therefore contributes one evidence unit regardless of review count.
 */
export function reviewerMeanScoresBps(
  acceptedFeedback: readonly FeedbackEvaluation[],
): number[] {
  const scoresByReviewer = new Map<string, number[]>();

  for (const item of acceptedFeedback) {
    const reviewer = item.clientAddress.toLowerCase();
    const scores = scoresByReviewer.get(reviewer) ?? [];
    if (item.scoreBps === undefined) {
      throw new TypeError("Accepted feedback must include scoreBps");
    }
    scores.push(item.scoreBps);
    scoresByReviewer.set(reviewer, scores);
  }

  return [...scoresByReviewer.values()].map((scores) => averageScoreBps(scores)!);
}
