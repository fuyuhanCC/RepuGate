export const MAX_SCORE_BPS = 10_000;
export const DEFAULT_MINIMUM_DISTINCT_REVIEWERS = 3;
export const BAYESIAN_PRIOR_STRENGTH = 2;

const MAX_SCORE = 100n;

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

export function toQualityScoreBps(
  value: bigint,
  valueDecimals: number,
): number | null {
  if (
    !Number.isSafeInteger(valueDecimals) ||
    valueDecimals < 0 ||
    valueDecimals > 18
  ) {
    throw new RangeError("valueDecimals must be an integer between 0 and 18");
  }

  const scale = 10n ** BigInt(valueDecimals);

  if (value < 0n || value > MAX_SCORE * scale) {
    return null;
  }

  return Number(divideRoundHalfUp(value * 100n, scale));
}

export function averageScoreBps(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SCORE_BPS) {
      throw new RangeError("score values must be integers between 0 and 10000");
    }
  }

  const sum = values.reduce((total, value) => total + BigInt(value), 0n);
  return Number(divideRoundHalfUp(sum, BigInt(values.length)));
}

export function confidenceFromDistinctReviewers(
  distinctReviewerCount: number,
): number {
  if (!Number.isSafeInteger(distinctReviewerCount) || distinctReviewerCount < 0) {
    throw new RangeError("distinctReviewerCount must be a non-negative safe integer");
  }

  return Number(
    (BigInt(distinctReviewerCount) * BigInt(MAX_SCORE_BPS)) /
      BigInt(distinctReviewerCount + BAYESIAN_PRIOR_STRENGTH),
  );
}
