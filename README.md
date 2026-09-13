# RepuGate

RepuGate is a reputation-gated x402 payment client for AI agents. It evaluates
ERC-8004-style service reputation, binds an `ALLOW` decision to one exact offer,
and exposes a narrow wallet capability only after a one-use Grant is consumed.

## Run the deterministic presentation demo

```bash
./pnpmw install
./pnpmw dev
```

Open <http://127.0.0.1:5173>. The Evaluation API listens on `127.0.0.1:3001`
and the independent x402 Demo Provider listens on `127.0.0.1:3002`; Vite
proxies both services. This mode uses a FakeWallet and simulated settlement; it
never opens MetaMask, broadcasts a transaction, or spends real funds.

`pnpmw` is the project-local launcher. On this Mac it automatically uses the
Node.js and pnpm runtime bundled with Codex, so no global installation or shell
`PATH` change is required. If pnpm is already installed globally, the launcher
uses that installation instead.

Recommended presentation checks:

1. Run `Honest service` with `B3 · RepuGate`: the decision is `ALLOW`, the wallet
   signs once, the independent Provider receives an initial 402 request and one
   paid retry, and the payment ends in `SETTLEMENT_PENDING` for reconciliation.
2. Run `Ungrounded ratings` with B1, then B2: B1 pays, while B2 rejects feedback
   without verified payment evidence and never calls the wallet.
3. Run `Reviewer concentration` with B2, then B3: B2 pays because every receipt
   is valid, while B3 caps repeated reviewer influence and returns `BLOCK`.
4. Run `Receipt replay` with B2 or B3: one reused receipt cannot create five trusted
   reviews.
5. Run `Offer substitution` with B3: the offer hash mismatch stops the flow
   before Grant consumption and signing.

## Regenerate the frozen experiment results

```bash
./pnpmw experiment
```

The command runs B1, B2, and B3 against the same five deterministic scenarios
through the production `evaluateOffer()` path. It writes a JSON report and CSV
table to `data/results/` and refreshes the generated report bundled by the Web
Attack Lab. No Web server, wallet, testnet, or database is required.

## Verification

```bash
./pnpmw typecheck
./pnpmw test
./pnpmw build
```

Architecture and threat-model details are in [design.md](./design.md) and
[code-architecture.md](./code-architecture.md), with Chinese versions alongside
them.
