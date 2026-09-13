import type { ReputationModel } from "@repugate/core";

import {
  experimentReport,
  type ExperimentResultRow,
} from "./report";

function modelLabel(model: ReputationModel): string {
  switch (model) {
    case "B1_RAW":
      return "B1 · Raw";
    case "B2_GROUNDED":
      return "B2 · Grounded";
    case "B3_REPUGATE":
      return "B3 · Beta";
    case "B3_DIRICHLET":
      return "B3 · Dirichlet";
  }
}

function percent(value: number | null): string {
  if (value === null) {
    return "—";
  }

  return `${(value / 100).toFixed(1)}%`;
}

function scoreFor(row: ExperimentResultRow): number | null {
  return row.model === "B1_RAW" ? row.rawScoreBps : row.verifiedScoreBps;
}

function resultFor(
  scenarioId: ExperimentResultRow["scenarioId"],
  model: ReputationModel,
): ExperimentResultRow {
  const result = experimentReport.results.find(
    (row) => row.scenarioId === scenarioId && row.model === model,
  );

  if (result === undefined) {
    throw new Error(`Missing experiment result for ${scenarioId}/${model}`);
  }

  return result;
}

export function AttackLab() {
  const attackScenarios = experimentReport.config.scenarios.filter(
    (scenarioId) => scenarioId !== "honest-service",
  );

  return (
    <section className="attack-lab" id="experiments">
      <div className="section-heading compact">
        <div>
          <span className="section-index">05 / ATTACK LAB</span>
          <h2>Each defense earns its place.</h2>
        </div>
        <div className="experiment-provenance">
          <span>Frozen core output</span>
          <code>{experimentReport.configHash.slice(0, 21)}…</code>
        </div>
      </div>

      <div className="experiment-summary">
        {experimentReport.summary.map((item) => (
          <article className="experiment-model" key={item.model}>
            <div className="experiment-model-heading">
              <strong>{modelLabel(item.model)}</strong>
              <span>
                {item.attackScenariosAllowed}/{item.attackScenarioCount} attacks paid
              </span>
            </div>
            <div className="experiment-measure">
              <div>
                <span>Attack scenario allow rate</span>
                <strong>{percent(item.attackScenarioAllowRateBps)}</strong>
              </div>
              <div className="experiment-bar danger">
                <i style={{ width: `${item.attackScenarioAllowRateBps / 100}%` }} />
              </div>
            </div>
            <div className="experiment-measure">
              <div>
                <span>Honest scenario allow rate</span>
                <strong>{percent(item.honestScenarioAllowRateBps)}</strong>
              </div>
              <div className="experiment-bar safe">
                <i style={{ width: `${item.honestScenarioAllowRateBps / 100}%` }} />
              </div>
            </div>
          </article>
        ))}
      </div>

      <div className="experiment-matrix-wrap">
        <table className="experiment-matrix">
          <thead>
            <tr>
              <th>Adversarial scenario</th>
              {experimentReport.config.models.map((model) => (
                <th key={model}>{modelLabel(model)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {attackScenarios.map((scenarioId) => {
              const rows = experimentReport.config.models.map((model) =>
                resultFor(scenarioId, model),
              );

              return (
                <tr key={scenarioId}>
                  <td>
                    <strong>{rows[0].scenarioTitle}</strong>
                    <small>{scenarioId}</small>
                  </td>
                  {rows.map((row) => (
                    <td key={row.model}>
                      <span className={`matrix-decision ${row.decision.toLowerCase()}`}>
                        {row.decision}
                      </span>
                      <small>{percent(scoreFor(row))} score</small>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="experiment-note">
        Rates summarize four fixed adversarial fixtures, not a population estimate.
        Regenerate this frozen artifact with <code>./pnpmw experiment</code>.
      </p>
    </section>
  );
}
