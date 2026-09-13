import { useState } from "react";

import {
  DemoApiError,
  loadLiveRegistry,
} from "../api/http-evaluation-api";
import type { LiveRegistryResponse } from "../api/dto";

function shortHex(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${(value / 100).toFixed(1)}%`;
}

function explorerAddress(chainId: number, address: string): string | null {
  switch (chainId) {
    case 1:
      return `https://etherscan.io/address/${address}`;
    case 84_532:
      return `https://sepolia.basescan.org/address/${address}`;
    case 11_155_111:
      return `https://sepolia.etherscan.io/address/${address}`;
    default:
      return null;
  }
}

export function LiveRegistryPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LiveRegistryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function inspect(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setResult(await loadLiveRegistry());
    } catch (caught) {
      setResult(null);
      setError(
        caught instanceof DemoApiError || caught instanceof Error
          ? caught.message
          : "Live registry lookup failed",
      );
    } finally {
      setLoading(false);
    }
  }

  const identityExplorer =
    result?.enabled === true
      ? explorerAddress(result.chainId, result.identityRegistry)
      : null;

  return (
    <section className="live-registry" id="live-registry">
      <div className="section-heading compact">
        <div>
          <span className="section-index">07 / OPTIONAL LIVE REGISTRY</span>
          <h2>Read the real trust layer.</h2>
        </div>
        <p>
          Live mode performs read-only ERC-8004 RPC calls. The deterministic
          Presentation fixtures remain the default path above.
        </p>
      </div>

      <div className="live-registry-shell">
        <div className="live-registry-action">
          <div>
            <span className="live-kicker">ERC-8004 · read only</span>
            <strong>Identity + raw reputation snapshot</strong>
            <small>No wallet, signature, transaction, or test USDC is used.</small>
          </div>
          <button disabled={loading} onClick={() => void inspect()} type="button">
            {loading ? "Reading RPC…" : "Inspect live registry"}
          </button>
        </div>

        {error !== null && <div className="error-banner">{error}</div>}

        {result?.enabled === false && (
          <div className="live-disabled">
            Live mode is disabled. Set the documented ERC-8004 environment
            variables when you want to inspect the configured onchain Agent.
            Fixture mode is still available for the Presentation.
          </div>
        )}

        {result?.enabled === true && (
          <>
            <div className="live-stats">
              <article>
                <span>Raw score</span>
                <strong>{percent(result.rawScoreBps)}</strong>
                <small>{result.eligibleFeedbackCount} eligible records</small>
              </article>
              <article>
                <span>Confidence</span>
                <strong>{percent(result.confidenceBps)}</strong>
                <small>{result.distinctReviewerCount} reviewers</small>
              </article>
              <article>
                <span>Chain snapshot</span>
                <strong>{result.identity.observedAtBlock}</strong>
                <small>chain ID {result.chainId}</small>
              </article>
            </div>
            <dl className="live-identity">
              <div>
                <dt>Agent</dt>
                <dd>#{result.identity.agent.agentId}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{shortHex(result.identity.owner)}</dd>
              </div>
              <div>
                <dt>Verified wallet</dt>
                <dd>{shortHex(result.identity.agentWallet)}</dd>
              </div>
              <div>
                <dt>Registered endpoint</dt>
                <dd>{result.identity.registeredEndpoint}</dd>
              </div>
              <div>
                <dt>Feedback events</dt>
                <dd>{result.feedbackCount}</dd>
              </div>
              <div>
                <dt>Identity Registry</dt>
                <dd>
                  {identityExplorer === null ? (
                    shortHex(result.identityRegistry)
                  ) : (
                    <a href={identityExplorer} rel="noreferrer" target="_blank">
                      {shortHex(result.identityRegistry)} ↗
                    </a>
                  )}
                </dd>
              </div>
            </dl>
            <p className="live-note">
              This first Live slice computes B1 from onchain feedback events.
              B2/B3 remain fail-closed until offchain payment claims and their
              transaction receipts are independently verified.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
