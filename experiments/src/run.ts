import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  experimentReportToCsv,
  runPresentationExperiment,
} from "./experiment";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDirectory = resolve(packageDirectory, "..");
const resultsDirectory = resolve(workspaceDirectory, "data/results");
const webDataDirectory = resolve(workspaceDirectory, "apps/web/src/data");
const jsonPath = resolve(resultsDirectory, "presentation-v1.json");
const csvPath = resolve(resultsDirectory, "presentation-v1.csv");
const webJsonPath = resolve(
  webDataDirectory,
  "experiment-results.generated.json",
);

const report = await runPresentationExperiment();
const json = `${JSON.stringify(report, null, 2)}\n`;

await Promise.all([
  mkdir(resultsDirectory, { recursive: true }),
  mkdir(webDataDirectory, { recursive: true }),
]);
await Promise.all([
  writeFile(jsonPath, json, "utf8"),
  writeFile(csvPath, experimentReportToCsv(report), "utf8"),
  writeFile(webJsonPath, json, "utf8"),
]);

process.stdout.write(
  [
    `Experiment ${report.runId}`,
    ...report.summary.map(
      (item) =>
        `${item.model}: honest allow ${item.honestScenarioAllowRateBps / 100}%, ` +
        `attack allow ${item.attackScenarioAllowRateBps / 100}%`,
    ),
    `JSON: ${jsonPath}`,
    `CSV: ${csvPath}`,
  ].join("\n") + "\n",
);
