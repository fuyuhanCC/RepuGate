# RepuGate

[English](./README.md) | [简体中文](./README.zh-CN.md)

RepuGate is a reputation-gated x402 payment client for AI agents. It evaluates
ERC-8004-style service reputation, binds an `ALLOW` decision to one exact offer,
and exposes a narrow wallet capability only after a one-use Grant is consumed.

## Documentation

| Document | English | 简体中文 |
| --- | --- | --- |
| System design, reputation models, experiments, and threat model | [design.md](./design.md) | [design.zh-CN.md](./design.zh-CN.md) |
| Code modules, dependency boundaries, and call relationships | [code-architecture.md](./code-architecture.md) | [code-architecture.zh-CN.md](./code-architecture.zh-CN.md) |

## Current reputation scope

The implemented experiment deliberately calculates one semantic dimension:
`tag1 = quality` on a documented 0–100 scale. Deterministic scenarios also use
`tag2 = inference` to select the AI-inference service subtype; `inference` is a
filter, not a second score.

Keeping one dimension makes the B1/B2/B3 reputation comparison interpretable:
each model receives ratings with the same meaning, and the experiment changes
evidence verification and aggregation rather than the target metric. B0 is the
no-reputation reference baseline. Identity binding,
payment validity, reviewer diversity, and confidence are trust or risk signals,
not extra quality dimensions. Latency, uptime, success rate, price, and revenue
have different units and must be normalized and evaluated separately instead of
being averaged directly into quality. Reviewer trust weighting and time decay
are documented as future extensions within the quality dimension.

## Integration with AgentHub (pre-release reputation gate)

[AgentHub](https://github.com/hryang1130/AgentHub) is an ERC-8004-style local
agent registry and task marketplace: agents register with a spec-compliant
`agent-card.json` and list priced skills; when a buyer places an order the
payment goes into escrow, the platform really calls the agent over HTTP to
execute the task, and only then decides whether to release the funds. Escrow
and settlement use local LGC credits to simulate the x402 payment layer.

RepuGate acts as the **pre-release reputation gate** in this ecosystem: before
releasing escrowed funds, AgentHub calls RepuGate's Evaluation API for a full
evaluation, and only an `ALLOW` releases the payment.

Interaction flow (AgentHub side implemented in `agent-platform/server.js`):

1. A buyer (the demo client or another agent — Agent-to-Agent trading is
   supported) orders a priced skill; the payment goes into escrow.
2. AgentHub executes the task: self-hosted agents are called over real HTTP,
   while platform-hosted ones run a simulated execution.
3. Before release, AgentHub resolves the scenario catalog via
   `GET {REPUGATE_URL}/api/services` (60 s cache) and then calls
   `POST {REPUGATE_URL}/api/evaluations` with `buyer`, `model` (default
   `B3_REPUGATE`), `scenarioId` (default `honest-service`; each agent may declare
   its own `repugateScenario` in its registration, choosing any of this repo's
   five deterministic scenarios), `offer` and `expectedOfferHash`, an idempotency
   key `order-<orderId>-<ts>`, and `tag2: inference`.
4. RepuGate responds with `decision` (`ALLOW` / `BLOCK` / `REVIEW`),
   `decisionId`, `decisionReasons`, `verifiedScoreBps`, `confidenceBps`,
   `distinctReviewerCount`, `riskFlags`, and `grantId`.
5. AgentHub settles the escrow accordingly: `ALLOW` releases funds to the agent;
   `BLOCK` refunds the buyer; `REVIEW` or `UNAVAILABLE` keeps the funds in escrow
   pending manual review — **fail-closed**: when RepuGate is unreachable (8 s
   timeout) or returns an unknown scenario, funds are never released
   automatically.

Every evaluation writes a `GateEvaluated` event to the AgentHub ledger, followed
by one of `PaymentReleased` / `PaymentBlocked` / `PaymentHeld`. Agent
registrations carry `repugate: { scenario, gate: 'repugate-policy-v1' }`,
`supportedTrust: ['reputation']`, and `x402Support: true`; AgentHub's
`GET /api/repugate` exposes the gate status.

Run both together:

```bash
# Terminal 1: start RepuGate (Evaluation API on 127.0.0.1:3001)
./pnpmw dev

# Terminal 2: start AgentHub (listens on http://localhost:8800)
node agent-platform/server.js
```

Environment variables: `REPUGATE_URL` (default `http://127.0.0.1:3001`) and
`REPUGATE_ENABLED=0` to disable the gate entirely and restore the original,
ungated release behavior.

## Run the deterministic presentation demo

```bash
./pnpmw install
./pnpmw dev
```

Open <http://127.0.0.1:5173>. The Evaluation API listens on `127.0.0.1:3001`
and the independent x402 Demo Provider listens on `127.0.0.1:3002`; Vite
proxies both services. This mode uses a FakeWallet and simulated settlement; it
never opens MetaMask, broadcasts a transaction, or spends real funds.

Fixture mode is always available and remains the default Presentation path.
It does not depend on an RPC endpoint, a live registry, or external metadata.

`pnpmw` is the project-local launcher. On this Mac it automatically uses the
Node.js and pnpm runtime bundled with Codex, so no global installation or shell
`PATH` change is required. If pnpm is already installed globally, the launcher
uses that installation instead.

Recommended presentation checks:

1. Run `Honest service` with `B0 · No rep.`: no reputation score is produced,
   but the common exact-offer and one-use Grant path still authorizes payment.
2. Run `Honest service` with either `B3 · Beta` or `B3 · Dirichlet`: the
   decision is `ALLOW`, the wallet signs once, the independent Provider receives
   an initial 402 request and one paid retry, and the payment ends in
   `SETTLEMENT_PENDING` for reconciliation.
3. Run `Ungrounded ratings` with B1, then B2: B1 pays, while B2 rejects feedback
   without verified payment evidence and never calls the wallet.
4. Run `Reviewer concentration` with B2, then either B3 model: B2 pays because
   every receipt is valid, while both B3 models cap repeated reviewer influence
   and return `BLOCK`.
5. Run `Receipt replay` with B2 or B3: one reused receipt cannot create five trusted
   reviews.
6. Run `Offer substitution` with B0 or any reputation model: the shared offer
   hash check stops the flow before Grant consumption and signing.

## Optional read-only ERC-8004 mode

The Web app also contains an **Optional Live Registry** inspector. It reads one
configured Agent from the official ERC-8004 Identity and Reputation registries
without requesting a wallet signature or sending a transaction.

```bash
cp .env.example .env
```

Set `REPUGATE_LIVE_ERC8004=true` and replace `ERC8004_AGENT_ID`,
`ERC8004_SERVICE_ENDPOINT`, and any network settings that differ from the
example. Then run `./pnpmw dev` and select **Inspect live registry** near the
bottom of the page. The API endpoint is `GET /api/live/erc8004`.

The live reader takes one block-number snapshot, verifies that the Reputation
Registry belongs to the configured Identity Registry, reads `ownerOf`,
`agentWallet`, and `tokenURI`, and validates the registration file's
self-reference and endpoint. It obtains the complete feedback key/value/tag and
revocation state through ERC-8004 `readAllFeedback()`. 8004scan supplies only
untrusted transaction locators; RepuGate fetches each receipt through its RPC,
decodes the Registry event, and requires the receipt fields to agree with
contract state before exposing a score. This avoids an unbounded historical
`eth_getLogs` scan without trusting the indexer's feedback values. Registration
downloads are read-only, HTTPS/IPFS constrained, redirect-free, time-limited,
and capped at 256 KiB.

This first Live slice computes **B1 raw reputation** only. It deliberately does
not fetch arbitrary `feedbackURI` documents or treat their payment claims as
verified evidence. The UI inventories observed `tag1`/`tag2` values and groups
strict-scope exclusions by reason; it does not reinterpret custom tags as
`quality`. Incomplete locator or Registry-event verification suppresses the B1
score. These receipts prove feedback-event authenticity, not x402 payment.
B2/B3 remain on the deterministic evidence path until a payment receipt
verifier is connected. A live lookup failure never falls back silently to
fixture data; the UI labels the failure while the Presentation demo remains
available.

## Regenerate the frozen experiment results

```bash
./pnpmw experiment
```

The command runs B0, B1, B2, B3-Beta, and B3-Dirichlet against the same five
deterministic scenarios through the production `evaluateOffer()` path. It
writes a JSON report and CSV table to `data/results/` and refreshes the
generated report bundled by the Web Attack Lab. No Web server, wallet, testnet,
or database is required.

## Verification

```bash
./pnpmw typecheck
./pnpmw test
./pnpmw build
```

See the [documentation table](#documentation) for the complete system-design
and code-architecture documents in both languages.
