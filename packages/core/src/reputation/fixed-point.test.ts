import { describe, expect, it } from "vitest";

import {
  averageScoreBps,
  confidenceFromDistinctReviewers,
  toQualityScoreBps,
} from "./fixed-point";

describe("fixed-point reputation math", () => {
  it.each([
    [87n, 0, 8_700],
    [875n, 1, 8_750],
    [8_750n, 2, 8_750],
    [1n, 1, 10],
    [0n, 18, 0],
    [100_000_000_000_000_000_000n, 18, 10_000],
  ])("converts %s with %s decimals to %s bps", (value, decimals, expected) => {
    expect(toQualityScoreBps(value, decimals)).toBe(expected);
  });

  it("rounds half up without floating-point arithmetic", () => {
    expect(toQualityScoreBps(5n, 3)).toBe(1);
    expect(averageScoreBps([8_000, 9_001])).toBe(8_501);
  });

  it("returns null for values outside the 0-100 quality range", () => {
    expect(toQualityScoreBps(-1n, 0)).toBeNull();
    expect(toQualityScoreBps(101n, 0)).toBeNull();
  });

  it("rejects invalid decimal and score inputs", () => {
    expect(() => toQualityScoreBps(1n, 19)).toThrow(RangeError);
    expect(() => averageScoreBps([10_001])).toThrow(RangeError);
  });

  it("derives confidence from evidence relative to prior strength", () => {
    expect(confidenceFromDistinctReviewers(0)).toBe(0);
    expect(confidenceFromDistinctReviewers(1)).toBe(3_333);
    expect(confidenceFromDistinctReviewers(3)).toBe(6_000);
    expect(confidenceFromDistinctReviewers(6)).toBe(7_500);
  });

  it("rejects invalid reviewer counts", () => {
    expect(() => confidenceFromDistinctReviewers(-1)).toThrow(RangeError);
    expect(() => confidenceFromDistinctReviewers(1.5)).toThrow(RangeError);
  });
});
