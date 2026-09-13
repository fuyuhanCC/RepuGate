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

Keeping one dimension makes the B1/B2/B3 comparison interpretable: each model
receives ratings with the same meaning, and the experiment changes evidence
verification and aggregation rather than the target metric. Identity binding,
payment validity, reviewer diversity, and confidence are trust or risk signals,
not extra quality dimensions. Latency, uptime, success rate, price, and revenue
have different units and must be normalized and evaluated separately instead of
being averaged directly into quality. Reviewer trust weighting and time decay
are documented as future extensions within the quality dimension.

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

1. Run `Honest service` with either `B3 · Beta` or `B3 · Dirichlet`: the
   decision is `ALLOW`, the wallet signs once, the independent Provider receives
   an initial 402 request and one paid retry, and the payment ends in
   `SETTLEMENT_PENDING` for reconciliation.
2. Run `Ungrounded ratings` with B1, then B2: B1 pays, while B2 rejects feedback
   without verified payment evidence and never calls the wallet.
3. Run `Reviewer concentration` with B2, then either B3 model: B2 pays because
   every receipt is valid, while both B3 models cap repeated reviewer influence
   and return `BLOCK`.
4. Run `Receipt replay` with B2 or B3: one reused receipt cannot create five trusted
   reviews.
5. Run `Offer substitution` with B3: the offer hash mismatch stops the flow
   before Grant consumption and signing.

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
`agentWallet`, and `tokenURI`, validates the registration file's self-reference
and endpoint, and reconstructs feedback plus revocations from registry events.
Registration downloads are read-only, HTTPS/IPFS constrained, redirect-free,
time-limited, and capped at 256 KiB.

This first Live slice computes **B1 raw reputation** only. It deliberately does
not fetch arbitrary `feedbackURI` documents or treat their payment claims as
verified evidence. B2/B3 remain on the deterministic evidence path until an EVM
receipt verifier is connected. A live lookup failure never falls back silently
to fixture data; the UI labels the failure while the Presentation demo remains
available.

## Regenerate the frozen experiment results

```bash
./pnpmw experiment
```

The command runs B1, B2, B3-Beta, and B3-Dirichlet against the same five
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
