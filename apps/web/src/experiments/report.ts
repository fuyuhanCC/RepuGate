import { z } from "zod";

import generatedReport from "../data/experiment-results.generated.json";

const modelSchema = z.enum([
  "B0_NO_GATE",
  "B1_RAW",
  "B2_GROUNDED",
  "B3_REPUGATE",
  "B3_DIRICHLET",
]);
const scenarioSchema = z.enum([
  "honest-service",
  "ungrounded-feedback",
  "receipt-replay",
  "reviewer-concentration",
  "offer-substitution",
]);

const resultRowSchema = z
  .object({
    scenarioId: scenarioSchema,
    scenarioTitle: z.string(),
    scenarioKind: z.enum(["CONTROL", "ADVERSARIAL"]),
    model: modelSchema,
    decision: z.enum(["ALLOW", "REVIEW", "BLOCK"]),
    paymentAuthorized: z.boolean(),
    rawScoreBps: z.number().int().min(0).max(10_000).nullable(),
    verifiedScoreBps: z.number().int().min(0).max(10_000).nullable(),
    confidenceBps: z.number().int().min(0).max(10_000).nullable(),
    distinctReviewerCount: z.number().int().nonnegative(),
    acceptedFeedbackCount: z.number().int().nonnegative(),
    rejectedFeedbackCount: z.number().int().nonnegative(),
    riskFlags: z.array(z.string()),
    offerRiskFlags: z.array(z.string()),
  })
  .strict();

const summarySchema = z
  .object({
    model: modelSchema,
    honestScenarioAllowRateBps: z.number().int().min(0).max(10_000),
    attackScenarioAllowRateBps: z.number().int().min(0).max(10_000),
    attackScenariosAllowed: z.number().int().nonnegative(),
    attackScenarioCount: z.number().int().positive(),
  })
  .strict();

const reportSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string(),
    configHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    config: z
      .object({
        schemaVersion: z.literal(1),
        dataset: z.literal("presentation-fixtures-v1"),
        models: z.array(modelSchema).length(5),
        scenarios: z.array(scenarioSchema).length(5),
        policy: z
          .object({
            version: z.string(),
            allowScoreBps: z.number().int(),
            allowConfidenceBps: z.number().int(),
            reviewScoreBps: z.number().int(),
          })
          .strict(),
      })
      .strict(),
    results: z.array(resultRowSchema).length(25),
    summary: z.array(summarySchema).length(5),
  })
  .strict();

export const experimentReport = reportSchema.parse(generatedReport);

export type ExperimentReport = z.infer<typeof reportSchema>;
export type ExperimentResultRow = z.infer<typeof resultRowSchema>;
