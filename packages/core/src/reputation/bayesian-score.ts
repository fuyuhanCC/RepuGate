import { MAX_SCORE_BPS } from "./fixed-point";

const DIRICHLET_CATEGORY_COUNT = 5;
const DIRICHLET_INTERVAL_BPS = 2_500;
const DIRICHLET_PRIOR_MASS_PER_CATEGORY = 4_000;
const EVIDENCE_UNIT = 10_000;

function validateReviewerScores(reviewerScoresBps: readonly number[]): void {
  for (const score of reviewerScoresBps) {
    if (!Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE_BPS) {
      throw new RangeError("reviewer scores must be integers between 0 and 10000");
    }
  }
}

function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

/** Posterior mean for continuous evidence under a Beta(1, 1) prior. */
export function betaPosteriorMeanBps(
  reviewerScoresBps: readonly number[],
): number | null {
  validateReviewerScores(reviewerScoresBps);
  if (reviewerScoresBps.length === 0) return null;

  const evidence = reviewerScoresBps.reduce(
    (sum, score) => sum + BigInt(score),
    0n,
  );
  const denominator = BigInt(reviewerScoresBps.length + 2);

  return Number(
    divideRoundHalfUp(BigInt(MAX_SCORE_BPS) + evidence, denominator),
  );
}

function fuzzyCategoryMass(scoreBps: number): bigint[] {
  const mass = Array<bigint>(DIRICHLET_CATEGORY_COUNT).fill(0n);

  if (scoreBps === MAX_SCORE_BPS) {
    mass[DIRICHLET_CATEGORY_COUNT - 1] = BigInt(EVIDENCE_UNIT);
    return mass;
  }

  const lowerCategory = Math.floor(scoreBps / DIRICHLET_INTERVAL_BPS);
  const distanceFromLower = scoreBps - lowerCategory * DIRICHLET_INTERVAL_BPS;
  const upperMass = distanceFromLower * 4;
  mass[lowerCategory] = BigInt(EVIDENCE_UNIT - upperMass);
  mass[lowerCategory + 1] = BigInt(upperMass);
  return mass;
}

/**
 * Posterior predictive probability that the next independent reviewer rates
 * the service Good (75) or Excellent (100), under a symmetric Dirichlet prior.
 */
export function dirichletGoodOrBetterBps(
  reviewerScoresBps: readonly number[],
): number | null {
  validateReviewerScores(reviewerScoresBps);
  if (reviewerScoresBps.length === 0) return null;

  const posteriorMass = Array<bigint>(DIRICHLET_CATEGORY_COUNT).fill(
    BigInt(DIRICHLET_PRIOR_MASS_PER_CATEGORY),
  );

  for (const score of reviewerScoresBps) {
    const evidence = fuzzyCategoryMass(score);
    for (let index = 0; index < DIRICHLET_CATEGORY_COUNT; index += 1) {
      posteriorMass[index] += evidence[index]!;
    }
  }

  const goodOrBetterMass = posteriorMass[3]! + posteriorMass[4]!;
  const totalMass = posteriorMass.reduce((sum, mass) => sum + mass, 0n);

  return Number(
    divideRoundHalfUp(
      goodOrBetterMass * BigInt(MAX_SCORE_BPS),
      totalMass,
    ),
  );
}
