import { useEffect, useState } from "react";

import { loadDecisions } from "../api/http-evaluation-api";
import type { DecisionHistoryItem } from "../api/dto";

function percent(value: number | null): string {
  return value === null || value === undefined ? "—" : `${(value / 100).toFixed(1)}%`;
}

function shortHex(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function formatTime(seconds: number): string {
  return new Date(seconds * 1_000).toLocaleString();
}

/**
 * Live 评估历史：直接读取 RepuGate 数据库里由外部调用方（例如 AgentHub 交易市场）
 * 产生的评估决策，用于核对放款门禁是否真的被触发。
 */
export function DecisionHistoryPanel() {
  const [items, setItems] = useState<DecisionHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setItems(await loadDecisions(50));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load decisions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const blocked = items.filter((item) => item.decision === "BLOCK").length;
  const allowed = items.filter((item) => item.decision === "ALLOW").length;
  const review = items.filter((item) => item.decision === "REVIEW").length;

  return (
    <section className="decision-history">
      <div className="decision-history-head">
        <div>
          <p className="eyebrow">Live evaluation ledger</p>
          <h2>Evaluation decisions · all callers</h2>
        </div>
        <button className="decision-refresh" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <p className="decision-history-note">
        Every call to <code>POST /api/evaluations</code> is persisted here, including
        decisions requested by external clients such as the AgentHub marketplace.
        Click a row to expand its full reason list.
      </p>

      <div className="decision-stats">
        <article><span>Total</span><strong>{items.length}</strong></article>
        <article><span>ALLOW</span><strong className="allow">{allowed}</strong></article>
        <article><span>REVIEW</span><strong className="review">{review}</strong></article>
        <article><span>BLOCK</span><strong className="block">{blocked}</strong></article>
      </div>

      {error === null ? null : <p className="decision-error">{error}</p>}

      <div className="runs-table-wrap">
        <table className="runs-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Model</th>
              <th>Decision</th>
              <th>Verified</th>
              <th>Confidence</th>
              <th>Reviewers</th>
              <th>Caller</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr className="empty-row">
                <td colSpan={8}>
                  {loading ? "Loading…" : "No decisions recorded yet."}
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const isOpen = expanded === item.decisionId;
                const reasons = [
                  ...(item.decisionReasons ?? []),
                  ...(item.offerRiskFlags ?? []).map((flag) => `OFFER_RISK:${flag}`),
                  ...(item.riskFlags ?? []),
                ];
                return (
                  <tr
                    key={item.decisionId}
                    onClick={() => setExpanded(isOpen ? null : item.decisionId)}
                    className="history-row"
                  >
                    <td className="mono-cell">{formatTime(item.createdAt)}</td>
                    <td><span className="model-tag">{item.model ?? "—"}</span></td>
                    <td>
                      <span className={`table-decision ${(item.decision ?? "").toLowerCase()}`}>
                        {item.decision ?? "—"}
                      </span>
                    </td>
                    <td>{percent(item.verifiedScoreBps)}</td>
                    <td>{percent(item.confidenceBps)}</td>
                    <td>{item.distinctReviewerCount}</td>
                    <td className="mono-cell">{shortHex(item.buyer)}</td>
                    <td className="reason-cell">
                      {reasons.length === 0
                        ? "—"
                        : isOpen
                          ? reasons.join(" · ")
                          : `${reasons[0]}${reasons.length > 1 ? ` +${reasons.length - 1}` : ""}`}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
