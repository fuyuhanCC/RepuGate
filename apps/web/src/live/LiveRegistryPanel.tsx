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

function explorerRoot(chainId: number): string | null {
  switch (chainId) {
    case 1:
      return "https://etherscan.io";
    case 84_532:
      return "https://sepolia.basescan.org";
    case 11_155_111:
      return "https://sepolia.etherscan.io";
    default:
      return null;
  }
}

function explorerAddress(chainId: number, address: string): string | null {
  const root = explorerRoot(chainId);
  return root === null ? null : `${root}/address/${address}`;
}

function explorerBlock(chainId: number, block: string): string | null {
  const root = explorerRoot(chainId);
  return root === null ? null : `${root}/block/${block}`;
}

function networkName(chainId: number): string {
  switch (chainId) {
    case 1:
      return "Ethereum Mainnet";
    case 84_532:
      return "Base Sepolia";
    case 11_155_111:
      return "Ethereum Sepolia";
    default:
      return `Chain ${chainId}`;
  }
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function displayTag(value: string): string {
  return value === "" ? "<empty>" : value;
}

function AddressValue({
  address,
  chainId,
}: {
  address: string;
  chainId: number;
}) {
  const explorer = explorerAddress(chainId, address);
  return explorer === null ? (
    <>{shortHex(address)}</>
  ) : (
    <a href={explorer} rel="noreferrer" target="_blank" title={address}>
      {shortHex(address)} ↗
    </a>
  );
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
  const blockExplorer =
    result?.enabled === true
      ? explorerBlock(result.chainId, result.identity.observedAtBlock)
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
            <div className="live-mode-strip">
              <span>Live RPC</span>
              <span>Read only</span>
              <span>{networkName(result.chainId)}</span>
              <span>B1 raw reputation</span>
              <span>No payment</span>
              <span
                className={
                  result.verificationStatus === "VERIFIED" ? "verified" : "warning"
                }
              >
                {result.verificationStatus === "VERIFIED"
                  ? "History verified"
                  : "History incomplete"}
              </span>
            </div>
            <div className="live-stats">
              <article>
                <span>Raw score</span>
                <strong>{percent(result.rawScoreBps)}</strong>
                <small>
                  {result.verificationStatus === "VERIFIED"
                    ? "quality · endpoint scoped"
                    : "suppressed until history is verified"}
                </small>
              </article>
              <article>
                <span>Confidence</span>
                <strong>{percent(result.confidenceBps)}</strong>
                <small>
                  {result.verificationStatus === "VERIFIED"
                    ? `${result.distinctReviewerCount} reviewers`
                    : "suppressed until history is verified"}
                </small>
              </article>
              <article>
                <span>Accepted</span>
                <strong>{result.eligibleFeedbackCount}</strong>
                <small>of {result.feedbackCount} feedback events</small>
              </article>
              <article>
                <span>Rejected</span>
                <strong>{result.rejectedFeedbackCount}</strong>
                <small>out of scope or invalid</small>
              </article>
              <article>
                <span>Chain snapshot</span>
                <strong>
                  {blockExplorer === null ? (
                    result.identity.observedAtBlock
                  ) : (
                    <a
                      href={blockExplorer}
                      rel="noreferrer"
                      target="_blank"
                      title={`Block ${result.identity.observedAtBlock}`}
                    >
                      {result.identity.observedAtBlock} ↗
                    </a>
                  )}
                </strong>
                <small>chain ID {result.chainId}</small>
              </article>
            </div>
            <dl className="live-identity">
              <div>
                <dt>Network</dt>
                <dd>{networkName(result.chainId)}</dd>
              </div>
              <div>
                <dt>Agent</dt>
                <dd>#{result.identity.agent.agentId}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>
                  <AddressValue
                    address={result.identity.owner}
                    chainId={result.chainId}
                  />
                </dd>
              </div>
              <div>
                <dt>Verified wallet</dt>
                <dd>
                  <AddressValue
                    address={result.identity.agentWallet}
                    chainId={result.chainId}
                  />
                </dd>
              </div>
              <div>
                <dt>Registered endpoint</dt>
                <dd title={result.identity.registeredEndpoint}>
                  {result.identity.registeredEndpoint}
                </dd>
              </div>
              <div>
                <dt>Feedback source</dt>
                <dd>contract state + verified receipts</dd>
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
              <div>
                <dt>Reputation Registry</dt>
                <dd>
                  <AddressValue
                    address={result.reputationRegistry}
                    chainId={result.chainId}
                  />
                </dd>
              </div>
            </dl>
            <div className="live-verification-grid">
              <article>
                <span>Onchain records</span>
                <strong>{result.onchainFeedbackCount}</strong>
                <small>returned by readAllFeedback</small>
              </article>
              <article>
                <span>Indexed locators</span>
                <strong>{result.locatorFeedbackCount}</strong>
                <small>{result.locatorSource} transaction hints</small>
              </article>
              <article>
                <span>Verified receipts</span>
                <strong>{result.verifiedReceiptCount}</strong>
                <small>decoded against the Registry</small>
              </article>
              <article>
                <span>Completeness</span>
                <strong
                  className={
                    result.verificationStatus === "VERIFIED"
                      ? "verified"
                      : "warning"
                  }
                >
                  {result.verificationStatus}
                </strong>
                <small>score is fail-closed when incomplete</small>
              </article>
            </div>
            <div className="live-risk-summary">
              <div>
                <span>Evidence signals</span>
                <small>
                  B1 filters the configured quality and endpoint scope. It does
                  not treat the locator API as trusted evidence or verify x402
                  payment receipts.
                </small>
              </div>
              <div className="live-risk-flags">
                {result.riskFlags.length === 0 ? (
                  <span className="clear">No B1 risk flags</span>
                ) : (
                  result.riskFlags.map((flag) => (
                    <span className="risk" key={flag} title={flag}>
                      {humanize(flag)}
                    </span>
                  ))
                )}
              </div>
            </div>
            <div className="live-evidence-diagnostics">
              <div className="live-diagnostic-heading">
                <div>
                  <span>Feedback compatibility</span>
                  <strong>Strict scope, no automatic tag mapping</strong>
                </div>
                <small>
                  Required tag1: {result.inspectionScope.tag1} · tag2: any ·
                  endpoint: exact registered endpoint
                </small>
              </div>
              {result.verificationIssueCounts.length > 0 && (
                <div className="live-verification-issues">
                  <span>History verification issues</span>
                  <div>
                    {result.verificationIssueCounts.map((item) => (
                      <code key={item.code} title={item.code}>
                        {humanize(item.code)} · {item.count}
                      </code>
                    ))}
                  </div>
                </div>
              )}
              <div className="live-diagnostic-grid">
                <article>
                  <span>Observed tag1</span>
                  <div className="live-count-list">
                    {result.tag1Distribution.length === 0 ? (
                      <small>No feedback events</small>
                    ) : (
                      result.tag1Distribution.map((item) => (
                        <div key={item.value}>
                          <code>{displayTag(item.value)}</code>
                          <strong>{item.count}</strong>
                        </div>
                      ))
                    )}
                  </div>
                </article>
                <article>
                  <span>Observed tag2</span>
                  <div className="live-count-list">
                    {result.tag2Distribution.length === 0 ? (
                      <small>No feedback events</small>
                    ) : (
                      result.tag2Distribution.map((item) => (
                        <div key={item.value}>
                          <code>{displayTag(item.value)}</code>
                          <strong>{item.count}</strong>
                        </div>
                      ))
                    )}
                  </div>
                </article>
                <article>
                  <span>Rejection reasons</span>
                  <div className="live-count-list rejected">
                    {result.rejectionReasonCounts.length === 0 ? (
                      <small>No rejected feedback</small>
                    ) : (
                      result.rejectionReasonCounts.map((item) => (
                        <div key={item.reason} title={item.reason}>
                          <code>{humanize(item.reason)}</code>
                          <strong>{item.count}</strong>
                        </div>
                      ))
                    )}
                  </div>
                </article>
              </div>
            </div>
            <p className="live-note">
              This Live slice computes B1 only after contract state, indexed
              transaction locators, and decoded Registry events agree. B2/B3
              remain fail-closed until offchain payment claims and their x402
              receipts are independently verified.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
