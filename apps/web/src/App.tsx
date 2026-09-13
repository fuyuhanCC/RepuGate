import { useEffect, useMemo, useState } from "react";

import type {
  PaymentResponse,
  TrustedFetchResult,
  TrustedFetchStage,
} from "@repugate/client";
import { TrustedFetchError, trustedFetch } from "@repugate/client";
import type {
  Bytes32,
  OfferEvaluationResult,
  ReputationModel,
} from "@repugate/core";
import {
  canonicalizeOffer,
  hashRequestBody,
} from "@repugate/core";

import {
  checkApiHealth,
  HttpEvaluationApi,
  loadServiceCatalog,
} from "./api/http-evaluation-api";
import type { ServiceCatalogItem } from "./api/dto";
import {
  BrowserIdempotencyKeys,
  DemoWallet,
} from "./demo/demo-runtime";
import { AttackLab } from "./experiments/AttackLab";
import { LiveRegistryPanel } from "./live/LiveRegistryPanel";
import {
  checkProviderHealth,
  HttpProviderFetch,
} from "./provider/http-provider-fetch";

const SCENARIO_META: Record<
  ServiceCatalogItem["id"],
  { number: string; label: string; category: string }
> = {
  "honest-service": {
    number: "01",
    label: "Honest service",
    category: "control",
  },
  "ungrounded-feedback": {
    number: "02",
    label: "Ungrounded ratings",
    category: "sybil",
  },
  "receipt-replay": {
    number: "03",
    label: "Receipt replay",
    category: "replay",
  },
  "reviewer-concentration": {
    number: "04",
    label: "Reviewer concentration",
    category: "confidence",
  },
  "offer-substitution": {
    number: "05",
    label: "Offer substitution",
    category: "binding",
  },
};

const FLOW: Array<{ stage: TrustedFetchStage; title: string; caption: string }> = [
  { stage: "INITIAL_REQUEST", title: "Discover", caption: "Request provider" },
  { stage: "PAYMENT_REQUIRED", title: "Challenge", caption: "Parse HTTP 402" },
  { stage: "OFFER_SELECTED", title: "Bind", caption: "Hash exact offer" },
  { stage: "EVALUATED", title: "Evaluate", caption: "B0–B3 policy" },
  { stage: "GRANT_CONSUMED", title: "Authorize", caption: "Consume Grant" },
  { stage: "WALLET_AUTHORIZED", title: "Sign", caption: "Narrow wallet port" },
  { stage: "PAYMENT_SUBMITTED", title: "Submit", caption: "x402 payload" },
  { stage: "SETTLEMENT_REPORTED", title: "Reconcile", caption: "Pending proof" },
];

interface DemoRun {
  id: string;
  service: ServiceCatalogItem;
  model: ReputationModel;
  result: TrustedFetchResult | null;
  evaluation: OfferEvaluationResult | null;
  payment: PaymentResponse | null;
  walletSignCount: number;
  providerRequestCount: number;
  durationMs: number;
  error: { code: string; message: string } | null;
}

interface HistoryItem {
  id: string;
  scenario: string;
  model: ReputationModel;
  decision: string;
  verifiedScoreBps: number | null;
  confidenceBps: number | null;
  walletSignCount: number;
}

function shortHex(value: string | undefined): string {
  if (value === undefined) return "—";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value / 100).toFixed(1)}%`;
}

function modelLabel(model: ReputationModel): string {
  switch (model) {
    case "B0_NO_GATE":
      return "B0";
    case "B1_RAW":
      return "B1";
    case "B2_GROUNDED":
      return "B2";
    case "B3_REPUGATE":
      return "B3-Beta";
    case "B3_DIRICHLET":
      return "B3-Dirichlet";
  }
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function decisionOf(run: DemoRun | null): "ALLOW" | "REVIEW" | "BLOCK" | "—" {
  return run?.evaluation?.decision ?? "—";
}

function resultLabel(run: DemoRun | null): string {
  if (run === null) return "Ready to evaluate";
  if (run.error !== null) return run.error.code;
  if (run.result?.kind === "DENIED") return "Stopped before signing";
  if (run.result?.kind === "PAID") return "Settlement pending verification";
  if (run.result?.kind === "PAYMENT_FAILED") return run.result.reason;
  return "No payment required";
}

export function App() {
  const [services, setServices] = useState<ServiceCatalogItem[]>([]);
  const [selectedId, setSelectedId] =
    useState<ServiceCatalogItem["id"]>("honest-service");
  const [model, setModel] = useState<ReputationModel>("B3_REPUGATE");
  const [budget, setBudget] = useState("20000");
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<DemoRun | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      checkApiHealth(),
      checkProviderHealth(),
      loadServiceCatalog(),
    ])
      .then(([apiHealthy, providerHealthy, catalog]) => {
        if (cancelled) return;
        setApiOnline(apiHealthy && providerHealthy);
        setServices(catalog);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setApiOnline(false);
        setCatalogError(
          error instanceof Error ? error.message : "Failed to load service catalog",
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(() => {
      void Promise.all([checkApiHealth(), checkProviderHealth()]).then(
        ([apiHealthy, providerHealthy]) => {
          if (!cancelled) {
            setApiOnline(apiHealthy && providerHealthy);
          }
        },
      );
    }, 3_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const selectedService = useMemo(
    () => services.find((service) => service.id === selectedId) ?? null,
    [selectedId, services],
  );

  async function executeDemo(): Promise<void> {
    if (selectedService === null || running) return;
    const atomicBudget = BigInt(budget || "0");
    if (atomicBudget <= 0n) {
      setCatalogError("Budget must be a positive amount in USDC atomic units.");
      return;
    }

    setRunning(true);
    setCatalogError(null);
    const startedAt = performance.now();
    const wallet = new DemoWallet();
    const provider = new HttpProviderFetch(selectedService);
    const api = new HttpEvaluationApi();
    const offered = canonicalizeOffer(selectedService.offer).offer;
    const body = JSON.stringify({
      task: "Summarise the latest deterministic market snapshot",
      maxTokens: 128,
    });
    const expectedOfferHash = canonicalizeOffer({
      ...selectedService.expectedOffer,
      requestBodyHash: hashRequestBody(body),
    }).offerHash;

    let result: TrustedFetchResult | null = null;
    let error: DemoRun["error"] = null;
    try {
      result = await trustedFetch(
        offered.resourceUrl,
        {
          method: offered.method,
          headers: { "content-type": "application/json" },
          body,
        },
        {
          payment: {
            network: offered.network,
            asset: offered.asset,
            maxAmount: atomicBudget,
            maxTimeoutSeconds: 60,
          },
          evaluation: {
            model,
            scenarioId: selectedService.id,
            expectedOfferHash: expectedOfferHash as Bytes32,
            tag2: "inference",
          },
        },
        {
          fetchPort: provider,
          evaluationApi: api,
          wallet,
          idempotencyKeys: new BrowserIdempotencyKeys(),
        },
      );
    } catch (caught) {
      error = {
        code:
          caught instanceof TrustedFetchError
            ? caught.code
            : "DEMO_EXECUTION_FAILED",
        message:
          caught instanceof Error ? caught.message : "Unknown demo execution error",
      };
    }

    const completed: DemoRun = {
      id: crypto.randomUUID(),
      service: selectedService,
      model,
      result,
      evaluation: api.lastEvaluation?.evaluation ?? null,
      payment: api.lastPayment,
      walletSignCount: wallet.signCount,
      providerRequestCount: provider.requestCount,
      durationMs: performance.now() - startedAt,
      error,
    };
    setRun(completed);
    if (completed.evaluation !== null) {
      setHistory((items) => [
        {
          id: completed.id,
          scenario: SCENARIO_META[completed.service.id].label,
          model: completed.model,
          decision: completed.evaluation!.decision,
          verifiedScoreBps: completed.evaluation!.verifiedScoreBps,
          confidenceBps: completed.evaluation!.confidenceBps,
          walletSignCount: completed.walletSignCount,
        },
        ...items,
      ].slice(0, 6));
    }
    setRunning(false);
  }

  const evaluation = run?.evaluation ?? null;
  const stages = run?.result?.stages ?? [];
  const decision = decisionOf(run);
  const decisionTone = decision === "ALLOW" ? "allow" : decision === "—" ? "idle" : "block";
  const allRiskFlags = [
    ...(evaluation?.riskFlags ?? []),
    ...(evaluation?.offerRiskFlags ?? []),
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="RepuGate home">
          <span className="brand-mark"><span /></span>
          <span>RepuGate</span>
          <span className="version">v0.1 demo</span>
        </a>
        <nav className="nav-links" aria-label="Primary navigation">
          <a className="active" href="#console">Console</a>
          <a href="#evidence">Evidence</a>
          <a href="#experiments">Experiments</a>
        </nav>
        <div className={`api-status ${apiOnline === true ? "online" : "offline"}`}>
          <span className="status-dot" />
          {apiOnline === null
            ? "Checking services"
            : apiOnline
              ? "API + Provider online"
              : "Demo services offline"}
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="eyebrow"><span /> Reputation-gated agent payments</div>
          <h1>Trust before<br /><em>transaction.</em></h1>
          <p>
            RepuGate turns ERC-8004 reputation evidence into a one-use authorization
            boundary for x402 payments—before the wallet signs anything.
          </p>
          <div className="hero-protocol">
            <span>ERC-8004</span><i />
            <span>B0 / B1 / B2 / B3</span><i />
            <span>ALLOW Grant</span><i />
            <span>x402</span>
          </div>
        </section>

        <section className="console" id="console">
          <div className="section-heading">
            <div>
              <span className="section-index">01 / CONTROL PLANE</span>
              <h2>Buyer Agent Console</h2>
            </div>
            <p>Configure one deterministic request, then inspect every trust boundary.</p>
          </div>

          <div className="scenario-grid">
            {services.map((service) => {
              const meta = SCENARIO_META[service.id];
              return (
                <button
                  className={`scenario-card ${selectedId === service.id ? "selected" : ""}`}
                  key={service.id}
                  onClick={() => setSelectedId(service.id)}
                  type="button"
                >
                  <span className="scenario-number">{meta.number}</span>
                  <span className="scenario-copy">
                    <strong>{meta.label}</strong>
                    <small>{meta.category} · {service.offer.amount} atomic USDC</small>
                  </span>
                  <span className="radio-dot" />
                </button>
              );
            })}
          </div>

          <div className="control-strip">
            <div className="control-group">
              <label>Trust model</label>
              <div className="segmented">
                <button
                  className={model === "B0_NO_GATE" ? "active" : ""}
                  onClick={() => setModel("B0_NO_GATE")}
                  type="button"
                >B0 · No rep.</button>
                <button
                  className={model === "B1_RAW" ? "active" : ""}
                  onClick={() => setModel("B1_RAW")}
                  type="button"
                >B1 · Raw</button>
                <button
                  className={model === "B2_GROUNDED" ? "active" : ""}
                  onClick={() => setModel("B2_GROUNDED")}
                  type="button"
                >B2 · Grounded</button>
                <button
                  className={model === "B3_REPUGATE" ? "active" : ""}
                  onClick={() => setModel("B3_REPUGATE")}
                  type="button"
                >B3 · Beta</button>
                <button
                  className={model === "B3_DIRICHLET" ? "active" : ""}
                  onClick={() => setModel("B3_DIRICHLET")}
                  type="button"
                >B3 · Dirichlet</button>
              </div>
            </div>
            <div className="control-group budget-group">
              <label htmlFor="budget">Maximum budget</label>
              <div className="budget-input">
                <input
                  id="budget"
                  inputMode="numeric"
                  onChange={(event) => setBudget(event.target.value.replace(/\D/g, ""))}
                  value={budget}
                />
                <span>atomic USDC</span>
              </div>
            </div>
            <button
              className="run-button"
              disabled={running || selectedService === null || apiOnline !== true}
              onClick={() => void executeDemo()}
              type="button"
            >
              <span>{running ? "Running gate…" : "Run trustedFetch"}</span>
              <svg aria-hidden="true" viewBox="0 0 20 20">
                <path d="M4 10h11M11 5l5 5-5 5" />
              </svg>
            </button>
          </div>

          {catalogError !== null && <div className="error-banner">{catalogError}</div>}
        </section>

        <section className="metrics" aria-label="Evaluation metrics">
          <article className={`metric-card decision ${decisionTone}`}>
            <span className="metric-label">Policy decision</span>
            <strong>{decision}</strong>
            <small>{resultLabel(run)}</small>
          </article>
          <article className="metric-card">
            <span className="metric-label">Raw reputation</span>
            <strong>{percent(evaluation?.rawScoreBps)}</strong>
            <small>
              {evaluation?.model === "B0_NO_GATE"
                ? "Not evaluated by this baseline"
                : `${evaluation?.distinctReviewerCount ?? 0} distinct reviewers`}
            </small>
          </article>
          <article className="metric-card accent">
            <span className="metric-label">Verified score</span>
            <strong>{percent(evaluation?.verifiedScoreBps)}</strong>
            <small>
              {evaluation?.model === "B0_NO_GATE"
                ? "Reputation gate disabled"
                : "Payment-grounded feedback"}
            </small>
          </article>
          <article className="metric-card">
            <span className="metric-label">Confidence</span>
            <strong>{percent(evaluation?.confidenceBps)}</strong>
            <small>
              {evaluation?.model === "B0_NO_GATE"
                ? "Not applicable"
                : `${evaluation?.acceptedFeedback.length ?? 0} eligible records`}
            </small>
          </article>
          <article className="metric-card signature">
            <span className="metric-label">Wallet signatures</span>
            <strong>{run?.walletSignCount ?? 0}</strong>
            <small>{decision === "ALLOW" ? "Grant consumed once" : "Protected by gate"}</small>
          </article>
        </section>

        <section className="flow-section">
          <div className="section-heading compact">
            <div>
              <span className="section-index">02 / ENFORCEMENT PATH</span>
              <h2>One request. Eight checkpoints.</h2>
            </div>
            <div className="run-meta">
              <span>{run === null ? "No run" : `${run.durationMs.toFixed(0)} ms`}</span>
              <span>{run === null ? "—" : `${run.providerRequestCount} provider request${run.providerRequestCount === 1 ? "" : "s"}`}</span>
            </div>
          </div>

          <div className="flow-track">
            {FLOW.map((item, index) => {
              const reached = stages.includes(item.stage);
              const blocked =
                run !== null &&
                evaluation?.decision !== "ALLOW" &&
                index > FLOW.findIndex((candidate) => candidate.stage === "EVALUATED");
              return (
                <div className={`flow-step ${reached ? "reached" : ""} ${blocked ? "blocked" : ""}`} key={item.stage}>
                  <div className="step-node"><span>{String(index + 1).padStart(2, "0")}</span></div>
                  <strong>{item.title}</strong>
                  <small>{blocked ? "Not called" : item.caption}</small>
                </div>
              );
            })}
          </div>
        </section>

        <section className="detail-grid" id="evidence">
          <article className="panel evidence-panel">
            <div className="panel-heading">
              <div>
                <span className="section-index">03 / EVIDENCE</span>
                <h3>Decision evidence</h3>
              </div>
              <span className={`decision-chip ${decisionTone}`}>{decision}</span>
            </div>
            {evaluation === null ? (
              <div className="empty-state">Run a scenario to inspect accepted evidence and risk flags.</div>
            ) : (
              <>
                <div className="evidence-counts">
                  <div><strong>{evaluation.acceptedFeedback.length}</strong><span>accepted</span></div>
                  <div><strong>{evaluation.rejectedFeedback.length}</strong><span>rejected</span></div>
                  <div><strong>{allRiskFlags.length}</strong><span>risk flags</span></div>
                </div>
                <div className="reason-list">
                  {evaluation.decisionReasons.map((reason) => (
                    <div className="reason-row" key={reason}>
                      <span className="reason-icon">{decision === "ALLOW" ? "✓" : "!"}</span>
                      <span>{reason}</span>
                    </div>
                  ))}
                  {allRiskFlags.map((flag) => (
                    <div className="reason-row risk" key={flag}>
                      <span className="reason-icon">!</span>
                      <span>{humanize(flag)}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </article>

          <article className="panel binding-panel">
            <div className="panel-heading">
              <div>
                <span className="section-index">04 / EXACT BINDING</span>
                <h3>Authorization boundary</h3>
              </div>
              <span className="lock-icon">⌁</span>
            </div>
            <dl className="binding-list">
              <div><dt>Offer hash</dt><dd>{shortHex(evaluation?.offerHash)}</dd></div>
              <div><dt>Identity epoch</dt><dd>{shortHex(evaluation?.identity.identityEpoch)}</dd></div>
              <div><dt>Policy hash</dt><dd>{shortHex(evaluation?.policyHash)}</dd></div>
              <div><dt>Grant</dt><dd>{shortHex(run?.payment?.authorizedIntent.grantId)}</dd></div>
              <div><dt>Payment state</dt><dd className="state-value">{run?.payment?.payment.state ?? "NOT CREATED"}</dd></div>
            </dl>
            <p className="binding-note">
              The Buyer Agent never receives raw wallet access. It can only invoke a
              payment intent already bound to these values.
            </p>
          </article>
        </section>

        <AttackLab />

        <section className="runs-section" id="runs">
          <div className="section-heading compact">
            <div>
              <span className="section-index">06 / COMPARISON LOG</span>
              <h2>Recent deterministic runs</h2>
            </div>
            <p>Compare B0 through B3 on the same attack to isolate each defense.</p>
          </div>
          <div className="runs-table-wrap">
            <table className="runs-table">
              <thead>
                <tr>
                  <th>Scenario</th><th>Model</th><th>Decision</th>
                  <th>Verified</th><th>Confidence</th><th>Wallet calls</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 ? (
                  <tr className="empty-row"><td colSpan={6}>No evaluations recorded in this session.</td></tr>
                ) : history.map((item) => (
                  <tr key={item.id}>
                    <td>{item.scenario}</td>
                    <td><span className="model-tag">{modelLabel(item.model)}</span></td>
                    <td><span className={`table-decision ${item.decision.toLowerCase()}`}>{item.decision}</span></td>
                    <td>{percent(item.verifiedScoreBps)}</td>
                    <td>{percent(item.confidenceBps)}</td>
                    <td>{item.walletSignCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <LiveRegistryPanel />
      </main>

      <footer>
        <span>RepuGate · deterministic presentation mode</span>
        <span>Base Sepolia · exact / EIP-3009 · no real funds</span>
      </footer>
    </div>
  );
}
