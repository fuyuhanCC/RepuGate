import { describe, expect, it } from "vitest";

import {
  betaPosteriorMeanBps,
  dirichletGoodOrBetterBps,
} from "./bayesian-score";

describe("Bayesian reviewer-level scores", () => {
  it("uses the Beta(1, 1) posterior mean for continuous ratings", () => {
    expect(betaPosteriorMeanBps([])).toBeNull();
    expect(betaPosteriorMeanBps([9_000])).toBe(6_333);
    expect(betaPosteriorMeanBps([8_000, 9_000, 10_000])).toBe(7_400);
    expect(betaPosteriorMeanBps([10_000, 0, 0])).toBe(4_000);
  });

  it("maps continuous ratings into adjacent Dirichlet categories", () => {
    expect(dirichletGoodOrBetterBps([])).toBeNull();
    expect(dirichletGoodOrBetterBps([8_000, 9_000, 10_000])).toBe(7_600);
    expect(dirichletGoodOrBetterBps([10_000, 0, 0])).toBe(3_600);
    expect(dirichletGoodOrBetterBps([7_500])).toBe(6_000);
    expect(dirichletGoodOrBetterBps([6_250])).toBe(4_333);
  });

  it("rejects invalid fixed-point ratings", () => {
    expect(() => betaPosteriorMeanBps([10_001])).toThrow(RangeError);
    expect(() => dirichletGoodOrBetterBps([-1])).toThrow(RangeError);
  });
});
