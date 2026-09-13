import { createHash } from "node:crypto";

import {
  createDeterministicScenario,
  DEFAULT_POLICY_CONFIG,
  DETERMINISTIC_SCENARIO_IDS,
  evaluateOffer,
} from "@repugate/core";
import type {
  Decision,
  DeterministicScenarioId,
  ReputationModel,
} from "@repugate/core";

export const EXPERIMENT_MODELS = [
  "B1_RAW",
  "B2_GROUNDED",
  "B3_REPUGATE",
  "B3_DIRICHLET",
] as const satisfies readonly ReputationModel[];

export type ScenarioKind = "CONTROL" | "ADVERSARIAL";

export interface ExperimentConfig {
  schemaVersion: 1;
  dataset: "presentation-fixtures-v1";
  models: readonly ReputationModel[];
  scenarios: readonly DeterministicScenarioId[];
  policy: typeof DEFAULT_POLICY_CONFIG;
}

export interface ExperimentResultRow {
  scenarioId: DeterministicScenarioId;
  scenarioTitle: string;
  scenarioKind: ScenarioKind;
  model: ReputationModel;
  decision: Decision;
  paymentAuthorized: boolean;
  rawScoreBps: number | null;
  verifiedScoreBps: number | null;
  confidenceBps: number;
  distinctReviewerCount: number;
  acceptedFeedbackCount: number;
  rejectedFeedbackCount: number;
  riskFlags: string[];
  offerRiskFlags: string[];
}

export interface ExperimentModelSummary {
  model: ReputationModel;
  honestScenarioAllowRateBps: number;
  attackScenarioAllowRateBps: number;
  attackScenariosAllowed: number;
  attackScenarioCount: number;
}

export interface ExperimentReport {
  schemaVersion: 1;
  runId: string;
  configHash: string;
  config: ExperimentConfig;
  results: ExperimentResultRow[];
  summary: ExperimentModelSummary[];
}

export const PRESENTATION_EXPERIMENT_CONFIG: ExperimentConfig = {
  schemaVersion: 1,
  dataset: "presentation-fixtures-v1",
  models: EXPERIMENT_MODELS,
  scenarios: DETERMINISTIC_SCENARIO_IDS,
  policy: DEFAULT_POLICY_CONFIG,
};

function rateBps(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }

  return Math.round((numerator * 10_000) / denominator);
}

function configHash(config: ExperimentConfig): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(config))
    .digest("hex")}`;
}

function scenarioKind(id: DeterministicScenarioId): ScenarioKind {
  return id === "honest-service" ? "CONTROL" : "ADVERSARIAL";
}

function summarize(
  results: readonly ExperimentResultRow[],
): ExperimentModelSummary[] {
  return EXPERIMENT_MODELS.map((model) => {
    const modelResults = results.filter((row) => row.model === model);
    const honest = modelResults.filter((row) => row.scenarioKind === "CONTROL");
    const attacks = modelResults.filter(
      (row) => row.scenarioKind === "ADVERSARIAL",
    );
    const honestAllowed = honest.filter((row) => row.paymentAuthorized).length;
    const attacksAllowed = attacks.filter((row) => row.paymentAuthorized).length;

    return {
      model,
      honestScenarioAllowRateBps: rateBps(honestAllowed, honest.length),
      attackScenarioAllowRateBps: rateBps(attacksAllowed, attacks.length),
      attackScenariosAllowed: attacksAllowed,
      attackScenarioCount: attacks.length,
    };
  });
}

export async function runPresentationExperiment(): Promise<ExperimentReport> {
  const results: ExperimentResultRow[] = [];

  for (const scenarioId of PRESENTATION_EXPERIMENT_CONFIG.scenarios) {
    for (const model of PRESENTATION_EXPERIMENT_CONFIG.models) {
      const scenario = createDeterministicScenario(scenarioId, model);
      const evaluation = await evaluateOffer(scenario.input, scenario.ports);

      results.push({
        scenarioId,
        scenarioTitle: scenario.title,
        scenarioKind: scenarioKind(scenarioId),
        model,
        decision: evaluation.decision,
        paymentAuthorized: evaluation.decision === "ALLOW",
        rawScoreBps: evaluation.rawScoreBps,
        verifiedScoreBps: evaluation.verifiedScoreBps,
        confidenceBps: evaluation.confidenceBps,
        distinctReviewerCount: evaluation.distinctReviewerCount,
        acceptedFeedbackCount: evaluation.acceptedFeedback.length,
        rejectedFeedbackCount: evaluation.rejectedFeedback.length,
        riskFlags: [...evaluation.riskFlags],
        offerRiskFlags: [...evaluation.offerRiskFlags],
      });
    }
  }

  const hash = configHash(PRESENTATION_EXPERIMENT_CONFIG);

  return {
    schemaVersion: 1,
    runId: `presentation-${hash.slice("sha256:".length, 19)}`,
    configHash: hash,
    config: PRESENTATION_EXPERIMENT_CONFIG,
    results,
    summary: summarize(results),
  };
}

function csvCell(value: string | number | boolean | null): string {
  const serialized = value === null ? "" : String(value);
  return `"${serialized.replaceAll('"', '""')}"`;
}

export function experimentReportToCsv(report: ExperimentReport): string {
  const columns = [
    "runId",
    "configHash",
    "scenarioId",
    "scenarioTitle",
    "scenarioKind",
    "model",
    "decision",
    "paymentAuthorized",
    "rawScoreBps",
    "verifiedScoreBps",
    "confidenceBps",
    "distinctReviewerCount",
    "acceptedFeedbackCount",
    "rejectedFeedbackCount",
    "riskFlags",
    "offerRiskFlags",
  ] as const;
  const lines = [columns.map(csvCell).join(",")];

  for (const row of report.results) {
    lines.push(
      [
        report.runId,
        report.configHash,
        row.scenarioId,
        row.scenarioTitle,
        row.scenarioKind,
        row.model,
        row.decision,
        row.paymentAuthorized,
        row.rawScoreBps,
        row.verifiedScoreBps,
        row.confidenceBps,
        row.distinctReviewerCount,
        row.acceptedFeedbackCount,
        row.rejectedFeedbackCount,
        row.riskFlags.join("|"),
        row.offerRiskFlags.join("|"),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return `${lines.join("\n")}\n`;
}
