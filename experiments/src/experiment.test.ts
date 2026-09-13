import { describe, expect, it } from "vitest";

import {
  experimentReportToCsv,
  runPresentationExperiment,
} from "./experiment";

describe("presentation experiment", () => {
  it("isolates payment grounding and reviewer-level aggregation", async () => {
    const report = await runPresentationExperiment();
    const summary = Object.fromEntries(
      report.summary.map((item) => [item.model, item]),
    );

    expect(report.results).toHaveLength(15);
    expect(summary.B1_RAW).toMatchObject({
      honestScenarioAllowRateBps: 10_000,
      attackScenarioAllowRateBps: 7_500,
    });
    expect(summary.B2_GROUNDED).toMatchObject({
      honestScenarioAllowRateBps: 10_000,
      attackScenarioAllowRateBps: 2_500,
    });
    expect(summary.B3_REPUGATE).toMatchObject({
      honestScenarioAllowRateBps: 10_000,
      attackScenarioAllowRateBps: 0,
    });
  });

  it("serializes every result as a CSV data row", async () => {
    const report = await runPresentationExperiment();
    const lines = experimentReportToCsv(report).trimEnd().split("\n");

    expect(lines).toHaveLength(report.results.length + 1);
    expect(lines[0]).toContain('"scenarioId"');
    expect(lines.some((line) => line.includes('"B2_GROUNDED"'))).toBe(true);
  });

  it("produces a stable configuration-derived run identifier", async () => {
    const first = await runPresentationExperiment();
    const second = await runPresentationExperiment();

    expect(second.configHash).toBe(first.configHash);
    expect(second.runId).toBe(first.runId);
    expect(second.results).toEqual(first.results);
  });
});
