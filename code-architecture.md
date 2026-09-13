# RepuGate Code Architecture

> This document maps the system design in `design.md` to the current TypeScript workspace, module boundaries, interface contracts, and Live-mode adapters.

## 1. Architecture Goals

The code architecture must satisfy these goals:

1. The presentation platform runs the complete `service discovery → trust evaluation → ALLOW/BLOCK → wallet authorization → x402 response` flow.
2. B1, B2, and B3 use the same scoring and policy code as the demo; there is no separate experiment-only algorithm.
3. Deterministic demo, experiment, and Base Sepolia Live modes switch through adapters. Core does not know whether data came from fixtures, SQLite, or RPC.
4. The Agent receives only a restricted `TrustedPaymentPort`, never MetaMask or an arbitrary signing capability.
5. Offer selection, offer hashing, Grant consumption, and payment-state transitions each have one authoritative implementation.
6. Runtime schemas validate external data before it enters Core.

## 2. Workspace Structure

```text
RepuGate/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/                    # router, providers, global error boundary
│   │   │   ├── agent/                  # ScriptedBuyerAgent
│   │   │   ├── features/
│   │   │   │   ├── service-explorer/
│   │   │   │   ├── trust-evaluation/
│   │   │   │   ├── payment/
│   │   │   │   └── attack-lab/
│   │   │   ├── api/                    # Evaluation API HTTP client
│   │   │   ├── wallet/                 # MetaMask WalletPort adapter
│   │   │   └── main.tsx
│   │   └── vite.config.ts
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/                 # HTTP input, schema validation, response mapping
│   │   │   ├── application/            # API use cases and transaction boundaries
│   │   │   ├── adapters/
│   │   │   │   ├── erc8004/            # optional read-only viem implementation
│   │   │   │   ├── evidence/           # receipt/Transfer verification
│   │   │   │   ├── persistence/        # SQLite repositories
│   │   │   │   └── clock/              # system/fixed clock
│   │   │   ├── config/
│   │   │   ├── app.ts                  # dependency composition and HTTP app
│   │   │   └── server.ts               # sole listen entry point
│   │   └── migrations/
│   └── provider/
│       └── src/
│           ├── app.ts                   # 402 challenge and paid request route
│           ├── app.test.ts              # provider protocol/security tests
│           └── server.ts
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── domain/                  # domain types and invariants
│   │       ├── schemas/                 # cross-boundary DTO runtime schemas
│   │       ├── canonicalization/        # offer/request/identity hashes
│   │       ├── reputation/              # B1/B2 plus B3 Beta and Dirichlet scoring
│   │       ├── policy/                  # ALLOW/REVIEW/BLOCK
│   │       ├── evaluation/              # shared evaluation use case
│   │       ├── grants/                  # pure Grant validation rules
│   │       ├── payments/                # payment-state reducer
│   │       ├── ports/                   # external capability interfaces
│   │       ├── errors/
│   │       └── index.ts
│   ├── client/
│       └── src/
│           ├── trustedFetch.ts
│           ├── offerSelector.ts
│           ├── guardedPaymentClient.ts
│           ├── x402ClientAdapter.ts
│           ├── ports.ts
│           └── index.ts
│   └── x402/
│       └── src/                         # shared headers, codec, schemas, types
├── experiments/
│   └── src/
│       ├── scenarios/                   # ungrounded/replay/substitution
│       ├── baselines/                   # B1/B2/B3 run configuration
│       ├── fixtures/
│       ├── metrics/
│       ├── run.ts
│       └── exportResults.ts
├── contracts/
│   └── MockEIP3009USDC.sol              # optional local protocol-test support
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── e2e/
├── data/
│   ├── fixtures/                        # versioned deterministic inputs
│   └── results/                         # frozen presentation results
├── var/                                 # local SQLite/logs; Git-ignored
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── package.json
└── .env.example
```

`contracts/` is not a prerequisite for the Presentation MVP. The mock contract is implemented only if local EIP-3009 behaviour needs to be tested.

## 3. Fixed Dependency Direction

```text
apps/web ───────→ packages/client ──────→ packages/core
    │                    │                      ↑
    │                    └→ packages/x402 ─────┤
    ├──────── HTTP ───────→ apps/api ──────────┤
    └──────── HTTP ───────→ apps/provider      │
                                  └→ packages/x402
experiments ───────────────────────────────→ packages/core

apps/api adapters ──→ RPC / ERC-8004 / SQLite
apps/provider Live x402 ─→ Facilitator / Base Sepolia
packages/client ────→ MetaMask / target Provider
```

The current API provides both adapter paths. Fixture readers remain the default
for the Presentation. `apps/api/src/adapters/erc8004/live-reader.ts` optionally
uses viem to read one block-consistent identity and feedback-event snapshot from
an ERC-8004 deployment. The Live Inspector currently exposes B1 raw reputation;
payment-proof document ingestion and EVM receipt verification remain separate
future adapters and are not simulated in Live mode.

The following rules are mandatory:

- `core` imports no React, Express/Fastify, SQLite, Node filesystem, or concrete RPC client.
- `client` imports no React and never accesses the API database.
- `web` enters payment flows only through `packages/client`; it does not construct signing requests itself.
- `api` does not import `web` or `client`.
- `experiments` calls the shared evaluator directly and does not duplicate scoring algorithms.
- `provider` reuses public domain types from `core` and protocol schemas from `packages/x402`; it does not import evaluation or policy code.
- A package exposes public APIs only through `index.ts` or explicit subpath exports. Cross-package imports of internal files are forbidden.

## 4. `packages/core`: Single Source of Business Rules

### 4.1 Domain Types

Core types remain framework-independent:

```ts
type Decision = "ALLOW" | "REVIEW" | "BLOCK";
type Baseline =
  | "B1_RAW"
  | "B2_GROUNDED"
  | "B3_REPUGATE"   // Beta(1,1) posterior mean
  | "B3_DIRICHLET"; // posterior P(Good or Excellent)

interface AgentReference {
  chainId: number;
  registry: `0x${string}`;
  agentId: bigint;
}

interface CanonicalOffer {
  method: string;
  resourceUrl: string;
  endpointHash: `0x${string}`;
  requestBodyHash: `0x${string}`;
  scheme: "exact";
  network: string;
  asset: `0x${string}`;
  amount: bigint;
  payTo: `0x${string}`;
  maxTimeoutSeconds: number;
  agent: AgentReference;
}

interface IdentitySnapshot {
  agent: AgentReference;
  owner: `0x${string}`;
  agentWallet: `0x${string}`;
  registeredEndpoint: string;
  agentUriHash: `0x${string}`;
  identityEpoch: `0x${string}`;
  observedAtBlock: bigint;
}
```

Amounts always use token atomic units represented as `bigint`. Database and JSON boundaries use decimal strings; asset amounts never use floating point.

### 4.2 Runtime Schemas

TypeScript types do not validate network input. The following objects require runtime schemas:

- `PaymentRequired`
- `repugate-agent` extension
- `/api/evaluations` request and response
- `EvaluationGrant`
- payment event
- experiment result
- ERC-8004 registration file and feedback document

Schemas validate shape and format; domain constructors enforce business invariants. HTTP routes do not repeat validation manually.

### 4.3 Canonicalization

`canonicalization/offer.ts` is the sole exact-offer hashing implementation:

1. Convert the HTTP method to uppercase.
2. Parse with WHATWG URL, remove the fragment, and normalize host, default port, and path.
3. Normalize EVM addresses and encode their address values rather than original strings.
4. Use a normalized CAIP-2 network string.
5. Use unsigned integer token atomic units for amount.
6. Hash the request body in the client; Core and API never persist the sensitive raw body.
7. ABI-encode all fields in a fixed order and compute keccak256.

The output includes at least:

```ts
interface CanonicalizedOffer {
  offer: CanonicalOffer;
  encodedOffer: `0x${string}`;
  offerHash: `0x${string}`;
}
```

The same input must produce the same hash in Web, API, experiments, and test golden vectors.

### 4.4 Shared Evaluation Use Case

`evaluation/evaluateOffer.ts` is the shared entry point used by the demo and experiments:

```ts
interface EvaluationPorts {
  identityReader: IdentityReader;
  feedbackReader: FeedbackReader;
  paymentProofVerifier: PaymentProofVerifier;
  receiptUsageReader: ReceiptUsageReader;
  clock: Clock;
}

async function evaluateOffer(
  input: EvaluateOfferInput,
  ports: EvaluationPorts,
): Promise<EvaluationResult>;
```

Its internal order is fixed:

```text
validate and canonicalize offer
  → resolve ERC-8004 identity
  → derive IdentityEpoch
  → load feedback for one semantic dimension
  → verify payment evidence and prior usage
  → calculate B1/B2/B3 scores
  → apply policy
  → return an explainable EvaluationResult
```

This function does not write a database, call MetaMask, send a payment, or issue a Grant.

### 4.5 Separate Reputation and Policy

`reputation` calculates signals only:

- raw score
- verified score
- confidence
- accepted/rejected feedback
- risk flags

`policy` maps those signals and payment context to a decision:

```ts
interface PolicyInput {
  score: ReputationAssessment;
  amount: bigint;
  identityMatched: boolean;
  offerRiskFlags: string[];
  policy: PolicyConfig;
}
```

Policy configuration is versioned and hashed as `policyHash`. Parameters cannot change silently after experiment freeze.

### 4.6 Pure Grant and Payment-State Rules

Core defines but does not persist a Grant:

```ts
interface EvaluationGrant {
  id: string;
  decisionId: string;
  offerHash: `0x${string}`;
  identityEpoch: `0x${string}`;
  buyer: `0x${string}`;
  policyHash: `0x${string}`;
  issuedAt: number;
  expiresAt: number;
  status: "ISSUED" | "CONSUMED" | "EXPIRED";
}
```

`payments/reducePaymentEvent.ts` is the sole source of payment transition rules. A client submits events; it never assigns state directly.

```text
CREATED → AUTHORIZED → SUBMITTED → SETTLEMENT_PENDING → SETTLED
    └──────────────── legal failure paths ─────────────────→ FAILED
```

## 5. `packages/client`: Guarded Payment Client

`packages/client` exposes one primary entry point to Web:

```ts
trustedFetch(input, dependencies): Promise<TrustedFetchResult>
```

Internal responsibilities:

- `offer-selector.ts`: selects one `accepts[]` entry by network, scheme, asset, budget, and timeout.
- `trusted-fetch.ts`: orchestrates the initial request, 402 parsing, evaluation, Grant use, and paid retry.
- `guarded-payment-client.ts`: consumes the Grant, rechecks the authorized intent field by field, calls WalletPort, and resubmits the request.
- `ports.ts`: defines `WalletPort`, `EvaluationApiPort`, and injectable `FetchPort`.

`packages/x402` owns the transport-level header constants, codec, runtime
schemas, and payload types shared by Client and Provider. Integration with an
official SDK is a Live adapter and does not change these application boundaries.

`WalletPort` is deliberately narrow:

```ts
interface WalletPort {
  getAddress(): Promise<`0x${string}`>;
  getChainId(): Promise<number>;
  signX402Authorization(intent: AuthorizedPaymentIntent): Promise<SignedPaymentPayload>;
}
```

It exposes no `sendTransaction`, arbitrary `signTypedData`, or raw `window.ethereum.request`.

## 6. `apps/api`: Orchestration, Transactions, and Persistence

### 6.1 Route Layer

A route performs only four tasks:

1. Parse and validate a request.
2. Call one application use case.
3. Map domain errors to stable HTTP/error codes.
4. Return a schema-validated DTO.

Routes contain no scoring, SQL, RPC, or transition rules.

### 6.2 Application Use Cases

Recommended use cases:

- `listServices`
- `evaluateAndIssueGrant`
- `getDecision`
- `consumeGrantAndCreatePayment`
- `recordPaymentEvent`
- `reconcileSettlement`
- `getPayment`
- `getLatestExperimentResult`

`evaluateAndIssueGrant` invokes the Core evaluator and stores the decision and optional Grant in one database transaction. Only `ALLOW` produces a Grant.

`consumeGrantAndCreatePayment` performs the following in one transaction:

```text
read ISSUED Grant
  → check expiry/buyer/offerHash/epoch/policyHash
  → compare-and-swap to CONSUMED
  → create payment_attempt(CREATED)
  → return the exact AuthorizedPaymentIntent
```

At most one concurrent request can therefore consume a Grant successfully.

### 6.3 Adapter Interfaces

Core ports include at least:

```ts
interface IdentityReader {
  resolve(ref: AgentReference): Promise<IdentitySnapshot>;
}

interface FeedbackReader {
  listQualityFeedback(ref: AgentReference): Promise<Feedback[]>;
}

interface PaymentProofVerifier {
  verify(proof: PaymentProof, identity: IdentitySnapshot): Promise<ProofVerification>;
}

interface Clock {
  now(): number;
}
```

Each port has two implementations:

- Live: viem RPC, ERC-8004 contracts, and a safe URI loader.
- Deterministic: versioned fixtures, fixed clock, and predefined receipts.

Mode selection occurs only in the composition root at `apps/api/src/app.ts`, never throughout business code.

## 7. `apps/web`: Presentation and Agent Controller

Pages are organized by feature rather than one global monolithic store. Query hooks own server state; temporary interaction state remains inside its feature.

### 7.1 Scripted Buyer Agent

The scripted Agent converts a user task into a restricted payment call:

```ts
interface TrustedPaymentPort {
  pay(input: {
    serviceId: string;
    url: string;
    method: "GET" | "POST";
    body?: unknown;
    maxAmount: string;
  }): Promise<TrustedFetchResult>;
}
```

The Agent may choose a service and budget. It cannot set a decision to `ALLOW` and never receives WalletPort.

### 7.2 Page Responsibilities

- Service Explorer displays catalog data and both reputation scores.
- Trust Evaluation drives one `trustedFetch` flow and shows its stages, evidence, and errors.
- Attack Lab reads frozen result JSON and visualizes B1/B2/B3. It does not run batch experiments in the browser.

Components do not call raw `fetch`, RPC, or MetaMask directly. Those operations pass through the API client, `trustedFetch`, and WalletPort adapter respectively.

## 8. `apps/provider`: Independent HTTP Boundary

Provider is an independent process exposing the deterministic scenario route:

```text
GET  /provider/health
POST /provider/services/:scenarioId/inference
```

The current Presentation MVP uses one frozen service identity. The scenario ID
selects controlled reputation evidence or provider behaviour; it is not
presented as a production multi-tenant identity system.

Without `PAYMENT-SIGNATURE`, the Provider returns a versioned HTTP 402 challenge.
With a payload, it validates the shared runtime schema and exact resource,
offer, authorization, and `repugate-agent` bindings before returning a simulated
settlement response.

Malicious behaviour is selected explicitly from the scenario ID rather than
through scattered environment-variable checks.

The honest scenario returns the expected offer. The `offer-substitution`
scenario returns a changed amount relative to the trusted catalog value, so the
Evaluation API blocks it before Grant consumption or wallet signing. Every
malicious scenario has an explicit name for tests and presentation explanations.

`packages/x402` is the shared protocol boundary for header names, base64 JSON
codec, runtime schemas, and TypeScript types. The deterministic Provider checks
payload structure and exact binding but deliberately does not claim to verify a
cryptographic signature or onchain settlement. An official x402 SDK/facilitator
adapter belongs to the later Live-mode slice.

## 9. Experiments: Offline Entry Point to the Real Core

The experiment runner starts neither Web nor the Live API. It calls the same `evaluateOffer()` with fixture adapters:

```text
scenario + seed
  → generate service, feedback, and receipt fixtures
  → run B1, B2, and B3 over the same samples
  → calculate malicious payment rate / honest approval rate / replay acceptance
  → write JSON/CSV with configHash
  → Attack Lab renders results read-only
```

The four adversarial presentation scenarios are fixed:

1. `ungrounded-feedback`
2. `receipt-replay`
3. `reviewer-concentration`
4. `offer-substitution`

Offer substitution is primarily an end-to-end security test and is not simulated by inventing a scoring result.

## 10. HTTP API Contract

```text
GET  /api/services
POST /api/evaluations
GET  /api/evaluations/:decisionId
POST /api/grants/:grantId/consume
POST /api/payments/:paymentId/events
GET  /api/payments/:paymentId
POST /api/payments/:paymentId/reconcile
```

Frozen experiment results do not pass through the Live API. `./pnpmw
experiment` writes JSON/CSV artifacts and refreshes the generated JSON module
bundled by the Web Attack Lab.

Key constraints:

- `/evaluations` receives raw fields required for a canonical offer. The API canonicalizes again and compares its hash with the client `offerHash`.
- `/grants/:id/consume` requires buyer, offerHash, identityEpoch, and policyHash. Grant IDs are high-entropy random values.
- `/payments/:id/events` accepts an `eventType`; it never accepts a client-assigned `state = SETTLED`.
- `settlement_received` means only that a Provider claim arrived. The API emits `settlement_verified` only after transaction verification.
- Mutation requests carry an idempotency key.
- API errors use stable codes; UI logic does not parse English messages.

## 11. SQLite Data Ownership

Minimum tables:

```text
services
decisions
decision_evidence
evaluation_grants
payment_attempts
payment_events
used_receipts
experiment_runs
```

Important uniqueness constraints:

```text
evaluation_grants.id                         UNIQUE
payment_attempts.payment_id                  UNIQUE
payment_events(payment_id, idempotency_key) UNIQUE
used_receipts(chain_id, tx_hash, log_index) UNIQUE
used_receipts(chain_id, authorization_nonce) UNIQUE WHERE nonce IS NOT NULL
```

The database stores body hashes, payload hashes, and necessary audit fields. It does not store MetaMask private keys, seed phrases, full sensitive request bodies, or unnecessary raw signatures.

Demo and experiment databases are separate:

```text
var/demo.sqlite
var/experiments/<run-id>.sqlite
data/results/<run-id>.json
```

## 12. Error Model and Observability

Unified error shape:

```ts
interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

Minimum error codes:

- `UNSUPPORTED_OFFER`
- `IDENTITY_MISMATCH`
- `INSUFFICIENT_CONFIDENCE`
- `GRANT_EXPIRED`
- `GRANT_ALREADY_CONSUMED`
- `OFFER_CHANGED`
- `WALLET_REJECTED`
- `SETTLEMENT_PENDING`
- `SETTLEMENT_INVALID`

Every log carries `requestId`; evaluation logs carry `decisionId`; payment logs carry `paymentId`. Logs omit PAYMENT-SIGNATURE, raw bodies, and full feedback documents by default.

## 13. Test Architecture

### Unit

- canonical offer golden vectors
- IdentityEpoch vectors
- B1/B2/B3 score and confidence
- policy threshold boundaries
- Grant expiry/mismatch
- payment event reducer

### Integration

- fixture adapters with Core evaluator
- atomic SQLite Grant consumption
- receipt uniqueness constraints
- API schema and error mapping
- Provider 402/paid-response flow

### Security

- feedback without payment does not enter B2 or B3
- the same receipt/nonce cannot score twice
- changing amount, asset, payTo, URL, body, or identity invalidates a Grant
- cross-origin redirects are denied by default
- pending settlement does not create a new nonce

### E2E

- deterministic complete flow with FakeWalletPort
- Honest Provider receives `ALLOW` and returns a result
- Malicious Provider may pass B1 or B2 but is denied by the stronger applicable model
- MetaMask with Base Sepolia is a separate manual smoke test, not a CI requirement
- the browser demo reaches Provider over HTTP; Honest makes a 402 request and one paid retry

## 14. Composition Root and Configuration

All implementation selection is centralized in `apps/api/src/app.ts`:

```text
REPUGATE_MODE=deterministic
  → FixtureIdentityReader
  → FixtureFeedbackReader
  → FixturePaymentProofVerifier
  → FixedClock

REPUGATE_MODE=live
  → ViemIdentityReader
  → Erc8004FeedbackReader
  → EvmPaymentProofVerifier
  → SystemClock
```

Private configuration exists only in server-process environment variables. The frontend receives only public chain IDs, contract addresses, and API base URL. `.env.example` contains placeholders only.

## 15. Implementation Order

Implementation proceeds in vertical slices:

1. `core` types, schemas, canonicalization, B1/B2/B3, policy, and unit tests.
2. Fixture adapters and `evaluateOffer()` to produce deterministic B1/B2/B3 results.
3. API and SQLite for decisions, one-use Grants, and payment state.
4. Web and FakeWalletPort for an end-to-end demo without testnet dependency.
5. Provider and x402 client adapter for the real `402` flow.
6. MetaMask and Base Sepolia Live smoke test.
7. Experiments and Attack Lab charts, followed by freezing presentation data.

A new module must fit one of these call paths. If it adds files without a new boundary or independently testable responsibility, it is not created.

## 16. Architecture Acceptance Criteria

Before feature expansion, the code must satisfy all of the following:

- No Agent payment path in Web bypasses `trustedFetch`.
- Core unit tests run without network, database, or React.
- Demo and experiments call the same B1/B2/B3 `evaluateOffer()` entry point.
- Only one concurrent consumption of the same Grant succeeds.
- The client cannot mark a payment `SETTLED` directly.
- Changing any security-critical offer field changes `offerHash`.
- Fixture mode runs fully offline; a Live-mode failure cannot break the demo.
- Provider is a separate process and shares x402 wire schemas with Client through `packages/x402`.
- Controlled malicious behaviour is selected explicitly and cannot silently alter the Honest scenario.
