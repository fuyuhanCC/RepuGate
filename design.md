# RepuGate Design

## 1. Project Overview

**Working title**

> RepuGate: A Payment-Grounded ERC-8004 Reputation Gateway for x402 Agent Services

**Positioning**

RepuGate is a client-side trust middleware that evaluates ERC-8004 identity and reputation evidence before an AI agent authorizes an x402 payment.

The project studies the following research question:

> How can an AI agent decide whether to pay an unfamiliar x402 service using ERC-8004 reputation when reputation feedback may be manipulated?

The project focuses on protecting the paying AI agent. It does not attempt to protect the service provider or provide a general-purpose blockchain security platform.

## 2. Motivation

x402 enables an AI agent to pay for an HTTP resource, but payment verification does not establish whether the resource provider is trustworthy. ERC-8004 provides standardized identity, reputation, and validation records for agents, but raw feedback may be spammed or manipulated.

RepuGate connects the payment decision point with reputation evidence:

```text
x402        answers: How should the agent pay?
ERC-8004    provides: Who is the service and what feedback exists?
RepuGate    decides: Should this agent authorize this payment?
```

The project treats ERC-8004 feedback as untrusted input. It verifies payment evidence, calculates a confidence-aware reputation score, and produces one of three decisions:

```text
ALLOW     The agent may authorize the payment automatically.
REVIEW    The evidence is insufficient or the risk is medium.
BLOCK     The agent should not authorize the payment.
```

## 3. Design Principles

1. **Application-scoped client enforcement**

   The payment decision is enforced before wallet authorization through a `trustedFetch()`-style client middleware. The Buyer Agent receives a typed payment capability, not the application's general-purpose wallet client.

2. **The gateway never stores private keys**

   Signing remains inside the selected `WalletPort`. Deterministic mode uses a FakeWallet with no real key; Live mode will use MetaMask. RepuGate supplies a narrowly scoped payment request only after an `ALLOW` decision and never receives a private key.

3. **Evidence before score**

   Feedback is validated before it is included in a reputation score.

4. **Core logic is independent of external infrastructure**

   Reputation and policy logic operate on normalized inputs. Blockchain RPC, ERC-8004, x402, and storage access are implemented as adapters.

5. **Fail safely for payments**

   Missing identity, stale data, RPC failures, and insufficient evidence must not silently result in an unrestricted automatic payment.

6. **Bounded scope**

   The course prototype supports a small, explicit subset of x402 and EVM functionality instead of attempting production-level multi-chain support.

7. **Reproducible evaluation**

   All security claims must be supported by controlled attacks, baseline comparisons, repeatable experiments, and saved result data.

8. **Decision-to-payment binding**

   An `ALLOW` decision is valid only for the exact x402 offer that was evaluated. It must not become a reusable approval for a different recipient, asset, amount, endpoint, identity state, or policy version.

9. **Idempotent payment handling**

   A timeout or uncertain settlement must be reconciled using the existing payment identifier, nonce, and transaction hash before a new authorization can be created.

## 4. Scope

### 4.1 Supported in the Course Prototype

- EVM-compatible chains
- x402 v2
- The x402 `exact` payment scheme
- test USDC payments on Base Sepolia; fixtures or mock settlement in deterministic mode
- One ERC-8004 identity per service
- One verified `agentWallet` per service
- One registered endpoint per experimental service
- Reputation values normalized to a 0-100 range
- One feedback record per payment receipt
- Fixed-seed fixtures and isolated mock state for reproducible experiments
- An optional live onchain demonstration on Base Sepolia
- A client-side `trustedFetch()` integration
- Exact selected-offer hashing and a short-lived, one-use `EvaluationGrant`
- ERC-8004 identity epoch tracking
- x402 payment identifiers and settlement reconciliation
- A browser-based presentation platform for interactive evaluation, payment, and experiment visualisation

### 4.2 Out of Scope

- Solana and non-EVM chains
- Cross-chain payments and reputation aggregation
- Batch settlement and escrow payment schemes
- A production x402 facilitator
- A production-scale blockchain indexer
- TEE, zkML, and stake-secured validation
- Full decentralized governance
- A production-grade Sybil detection system
- Global enforcement over payments initiated outside the RepuGate application
- Compromise of the user's wallet or host computer
- Attacks on blockchain consensus or cryptographic primitives
- A guarantee that an AI service's response is correct
- Production dispute resolution or proof of semantic service quality

## 5. System Architecture

```text
┌────────────────────────────────────────────────────────────────────┐
│ Presentation Web App                                              │
│ Buyer Agent / Agent Console / Service Explorer / Attack Lab       │
│                                                                    │
│ Agent Controller ──► trustedFetch ──► Offer Normalizer/Verifier   │
│                                      │                             │
│                             EvaluationGrant                        │
│                                      │                             │
│                              GuardedPaymentClient ──► MetaMask     │
└──────────────────────┬──────────────────────────┬──────────────────┘
                       │ /evaluate + grant        │ direct HTTP/x402
                       ▼                          ▼
┌────────────────────────────────────┐   ┌──────────────────────────┐
│ RepuGate Evaluation API            │   │ Demo x402 Provider       │
│ IdentityEpoch / Feedback Evidence  │   │ honest/faulty/malicious  │
│ Receipt Verification / Core Policy │   │ signed offer/receipt opt.│
│ Grant Store / Settlement Reconciler│   └────────────┬─────────────┘
└───────────────┬───────────┬────────┘                │
                ▼           ▼                         ▼
       ERC-8004/EVM RPC   SQLite              Facilitator / EVM
```

The architecture contains three main layers.

### 5.1 Core Layer

The Core layer contains deterministic, infrastructure-independent logic:

- reputation scoring
- confidence calculation
- suspicious-behaviour weighting
- cold-start handling
- payment-limit policy
- identity-epoch derivation
- evaluation-grant validation
- payment-state transition rules
- `ALLOW`, `REVIEW`, or `BLOCK` decision

The Core layer does not make RPC calls or read a database directly. This makes it possible to test the same logic with real chain data and synthetic experiment data.

### 5.2 Adapter Layer

The Adapter layer converts external data into normalized Core inputs:

- **ERC-8004 Adapter**: identity, `agentWallet`, endpoint, and feedback events
- **EVM Receipt Adapter**: transaction status, payer, recipient, token, amount, block number, and confirmation state
- **x402 Adapter**: payment requirements, offer/receipt extensions, payment identifiers, payment authorization, and settlement response
- **SQLite Adapter**: cache state, identity epochs, one-use grants, payment attempts, consumed receipts, and decision audit records

### 5.3 Application Layer

The project has four application entry points:

- **Presentation Web App**: contains the Buyer Agent, Agent Console, wallet connection, `trustedFetch()`, guarded payment client, and visualisation views
- **RepuGate Evaluation API**: resolves identity, validates evidence, evaluates policy, issues one-use grants, and reconciles uncertain settlements
- **Independent Demo Provider**: runs as a separate HTTP process and provides an x402 endpoint with configurable honest or malicious behaviour
- **Experiment Runner**: generates feedback and attack scenarios, runs baselines, and saves results

The Presentation Web App is a required project component. It is a focused demonstration interface rather than a production administration dashboard.

### 5.4 Presentation Web App

The frontend is a single-page React/Vite application with three primary views:

1. **Service Explorer**

   Lists the controlled honest and malicious demo services, their ERC-8004 identity, endpoint, wallet, raw reputation, and verified reputation.

2. **Trust Evaluation**

   Runs the payment decision flow for a selected service and displays the exact selected offer, offer hash, identity epoch, raw score, verified score, confidence, accepted and rejected feedback, risk reasons, and final `ALLOW`, `REVIEW`, or `BLOCK` decision. When enabled, a browser wallet signs only after a matching, unexpired `ALLOW` grant.

3. **Attack Lab**

   Loads reproducible attack results generated by a command-line experiment runner and compares B1, B2, B3-Beta, and B3-Dirichlet. Presentation mode uses deterministic saved scenarios so the result does not depend on testnet availability. The web application does not directly start long-running experiments.

The frontend may also show a receipt and audit-detail drawer within the Trust Evaluation view. A separate administration section, user-management system, and production analytics dashboard are outside the project scope.

## 6. Why Client-Side Middleware

The main integration takes the form of a `trustedFetch()` function rather than a traditional HTTP forward proxy.

```text
Buyer Agent calls a typed trusted-payment capability
        ↓
Service returns HTTP 402 + PaymentRequired
        ↓
trustedFetch selects and normalizes one exact offer
        ↓
RepuGate evaluates offer + IdentityEpoch + reputation evidence
        ↓
Evaluation API returns decision + one-use EvaluationGrant
        ↓
GuardedPaymentClient rechecks grant, offer hash, identity, and policy
        ↓
WalletPort signs the exact authorization only after ALLOW
(FakeWallet in deterministic mode; MetaMask in Live mode)
        ↓
Client resubmits the x402 request and tracks settlement by paymentId
```

This choice avoids proxying all request and response content, reduces privacy exposure, keeps the private key outside the gateway, removes unnecessary HTTP forwarding complexity, and keeps the implementation focused on the research problem.

For the browser demo, `trustedFetch()` calls a thin local RepuGate Evaluation API. The API exposes Core assessment, one-use Grant, and payment-state handling but does not proxy target API traffic. Frozen experiment JSON is bundled read-only by the Web app. The browser reaches the independent x402 Provider through a development reverse proxy and uses the configured WalletPort.

The implementation must keep offer selection under RepuGate control. It must not delegate selection to an opaque auto-payment wrapper that may choose a different `accepts[]` entry after evaluation. A lower-level x402 client flow or an explicit selector hook is used so the selected payment requirements are known before any signature request.

### 6.1 Capability Boundary

The Buyer Agent is part of the Presentation Web App. The presentation milestone uses a deterministic scripted Agent: it selects a service for a predefined task and calls the restricted payment capability without depending on an external LLM or stochastic output. An LLM may later be added as an explanation layer, but it cannot bypass policy or access the wallet directly. The Agent controller receives only an interface such as:

```ts
interface TrustedPaymentPort {
  pay(input: {
    url: string;
    method: string;
    maxAmount: string;
  }): Promise<TrustedFetchResult>;
}
```

It is not passed `window.ethereum`, a general wallet client, `sendTransaction`, or `signTypedData`. Wallet access remains in a private UI module used by `GuardedPaymentClient`.

This is an application-level security boundary, not a global wallet firewall. RepuGate guarantees that payment actions exposed to the in-scope Buyer Agent pass through the gate. It cannot prevent a user, another website, compromised same-origin JavaScript, or code outside the application from asking MetaMask to sign independently. Strong wallet-wide enforcement would require a signing proxy, delegated session key, or smart-account policy module and is outside the course prototype.

Minimum presentation API surface:

```text
GET  /api/services
POST /api/evaluations
GET  /api/evaluations/:decisionId
POST /api/grants/:grantId/consume
POST /api/payments/:paymentId/events
GET  /api/payments/:paymentId
POST /api/payments/:paymentId/reconcile
```

Optional read-only Live inspection adds `GET /api/live/erc8004`; the fixture
Presentation flow neither calls nor depends on this endpoint.

The web application must have two modes:

- **Deterministic demo mode** uses saved fixture/mock data and always remains available for the presentation.
- **Target Live payment mode** optionally connects MetaMask and performs a Base Sepolia x402 flow.

The implemented first Live slice is intentionally read-only. It resolves one
configured ERC-8004 identity and reconstructs raw feedback and revocations from
registry events at a shared block snapshot. The Web UI exposes this as an
optional inspector, while deterministic fixture mode remains the default and
never depends on RPC availability. Live B2/B3 payment grounding is fail-closed
until untrusted feedback claims can be fetched safely and verified against EVM
receipts; it is never replaced with simulated evidence or a silent fixture
fallback.

Experiments run through a separate command-line program and write immutable JSON/CSV artifacts to `data/results/`. The Presentation Web App bundles a generated copy of the frozen JSON and renders it read-only; experiments never share mutable Grant, payment, or replay-prevention state with the API.

## 7. Request and Decision Flow

### 7.1 Initial Request

The Buyer Agent in the Presentation Web App calls `trustedFetch()`. The service returns `402 Payment Required` with a `PaymentRequired` object. No payment authorization exists at this point.

### 7.2 Exact Offer Selection and Verification

`trustedFetch()` selects exactly one `accepts[]` entry and creates a canonical representation containing at least:

```text
HTTP method
canonical resource URL and endpoint hash
request body hash (a fixed empty value when there is no body)
scheme
network
asset
amount
payTo
maxTimeoutSeconds
relevant identity extension fields
```

`packages/core` supplies the sole `canonicalizeOffer()` implementation. It deterministically normalizes the URL, CAIP-2 network, EVM addresses, and numeric fields, ABI-encodes them in a fixed field order, and computes `offerHash = keccak256(encodedOffer)`. Web, API, and experiment code reuse this implementation rather than serializing JSON independently. If the provider supplies the official x402 Offer/Receipt extension, RepuGate also verifies the signed offer and checks that its fields match the selected `accepts[]` entry. An array index is never treated as authoritative. The signing key must be the `payTo` wallet or be verifiably authorized for the service domain.

Signed offers improve authenticity and portable audit evidence, but `EvaluationGrant.offerHash` remains mandatory because a receipt or helper that compares only a subset of fields is not sufficient for exact decision-to-payment binding.

### 7.3 Service Resolution and Identity Epoch

RepuGate resolves the service using:

- the target URL
- the x402 `payTo` address
- the claimed ERC-8004 `agentId`
- the registered endpoint
- the registered `agentWallet`

The service-provided `agentId` is not trusted without checking its registered endpoint and wallet.

The controlled Demo Provider carries `agentRegistry`, `agentId`, and `endpointHash` in a project-defined `repugate-agent` entry under `PaymentRequired.extensions`, explicitly labelled experimental. These values are resolution hints rather than trust anchors. `endpointHash` lets the client bind the offer before identity resolution; the Evaluation API must still derive it from the registered endpoint and reject a mismatch. RepuGate verifies the relationship among registry, endpoint, owner, `agentWallet`, and `payTo` through onchain reads or frozen fixtures, and never presents this extension as an official x402/ERC-8004 standard.

```json
{
  "extensions": {
    "repugate-agent": {
      "info": {
        "agentRegistry": "0x...",
        "agentId": "12",
        "endpointHash": "0x..."
      },
      "schema": { "type": "object" }
    }
  }
}
```

RepuGate derives the current identity epoch:

```text
identityEpoch = hash(
  agentRegistry,
  agentId,
  currentOwner,
  agentWallet,
  agentURIHash,
  endpointHash
)
```

An owner transfer, `agentWallet` replacement, endpoint replacement, or material registration-file change creates a new epoch. Historical feedback remains visible for audit, but it does not automatically give the new owner or endpoint the old operational reputation.

### 7.4 Feedback Loading

The ERC-8004 Adapter loads feedback associated with the resolved service identity. The following fields may be used:

- reviewer or `clientAddress`
- reputation value and decimals
- tags
- endpoint
- `feedbackURI`
- `feedbackHash`
- proof-of-payment data referenced by the feedback document

The current read-only Live adapter consumes the registry-owned fields through
`NewFeedback` and `FeedbackRevoked` events only. It does not yet dereference
arbitrary `feedbackURI` values, so proof-of-payment data is unavailable in Live
mode and only B1 raw reputation is reported. B2 and B3 require the separate
payment-evidence verifier described below and fail closed until it is connected.

Only feedback for the explicitly supported semantic dimension is aggregated in the MVP. The default is `tag1 = quality` with a value on a documented 0-100 scale. Incomparable tags such as latency, uptime, revenue, and quality are not averaged together.

`feedbackURI` is untrusted network input. The loader uses strict size and time limits, allows only configured HTTPS or IPFS sources, rejects redirects to private or loopback addresses except an explicit local-demo allowlist, validates content type, and verifies `feedbackHash` when present.

### 7.5 Payment-Evidence Verification

For each feedback item, RepuGate verifies as many of the following conditions as the selected experiment supports:

```text
The payment transaction exists.
The payment transaction succeeded.
The payer equals the feedback reviewer.
The recipient equals the service agentWallet.
The chain, token, and amount match the payment claim.
The feedback endpoint matches the registered service endpoint.
The payment occurred before the feedback was submitted.
The exact token-transfer log or authorization nonce is identified.
The evidence belongs to the current service IdentityEpoch.
The receipt key has not already been used for another accepted feedback item.
```

The verifier returns a normalized result:

```json
{
  "valid": false,
  "reason": "RECEIPT_REPLAYED"
}
```

Possible reasons include:

- `TRANSACTION_NOT_FOUND`
- `TRANSACTION_FAILED`
- `PAYER_MISMATCH`
- `RECIPIENT_MISMATCH`
- `SERVICE_MISMATCH`
- `TOKEN_OR_AMOUNT_MISMATCH`
- `INSUFFICIENT_CONFIRMATIONS`
- `RECEIPT_REPLAYED`
- `INVALID_FEEDBACK_DOCUMENT`

The deterministic evidence key is `(chainId, transactionHash, logIndex)` where a token-transfer log is available. The EIP-3009 authorization nonce is also stored for defense in depth. A transaction hash alone is not assumed to identify one payment when multicalls or multiple transfer logs are possible.

Evidence deduplication occurs during an atomic ingestion operation, not as a side effect of the read-only `/evaluate` request. Re-running an evaluation therefore cannot consume or corrupt evidence.

### 7.6 Reputation Assessment

The current scorer produces an assessment such as:

```json
{
  "rawScoreBps": 7800,
  "verifiedScoreBps": 7600,
  "confidenceBps": 6000,
  "distinctReviewerCount": 3,
  "riskFlags": []
}
```

Future live adapters may additionally carry a source-availability basis:

```text
measured           enough valid evidence was evaluated
insufficient-data  valid evidence exists but confidence is below policy needs
not-indexed        the service has not been ingested
degraded           an expected source failed or became stale
```

A missing or failed measurement is never silently converted into a neutral-looking score. The first presentation prototype requires verified-feedback filtering, bounded per-reviewer influence, reviewer diversity, and simple confidence handling. Funding-cluster heuristics and sophisticated Sybil detection remain optional.

### 7.7 Policy Decision and Evaluation Grant

The policy combines reputation, confidence, detected risks, and payment amount.

Illustrative policy:

```text
High score and sufficient confidence     ALLOW
New service or incomplete evidence       REVIEW or small trial payment
Low score or strong attack signal        BLOCK
Payment above the user's configured cap  BLOCK
```

Policy thresholds are experiment parameters, not universal definitions of trust.

An `ALLOW` result creates a short-lived, one-use grant:

```ts
type EvaluationGrant = {
  grantId: string;
  buyer: string;
  agentRef: string;
  identityEpoch: string;
  offerHash: string;
  paymentId: string;
  policyHash: string;
  evaluatedAtBlock: string;
  expiresAt: number;
};
```

The Evaluation API stores the grant and atomically marks it consumed when the guarded payment path uses it. A forged decision JSON, an expired grant, a changed identity epoch, a different buyer, a changed policy, or an offer-hash mismatch cannot authorize signing.

### 7.8 Guarded Wallet Authorization

Only a matching `ALLOW` grant permits `GuardedPaymentClient` to request a wallet signature. Immediately before calling MetaMask, it rechecks the exact authorization destination and value against the selected offer and grant. Redirects to a different origin are blocked by default; if allowed, the final URL and returned offer must be evaluated again.

RepuGate does not receive or store the wallet's private key. If the user rejects MetaMask, the consumed grant is not reused; a new evaluation is required.

### 7.9 Payment State and Settlement Reconciliation

Each attempt has a stable `paymentId` and follows this state machine:

```text
CREATED
  → AUTHORIZED
  → SUBMITTED
  → SETTLEMENT_PENDING
  → SETTLED | FAILED
```

The Evaluation API is the sole persistent writer for `payment_attempts`. The browser reports authorization, submission, and received settlement information through `POST /api/payments/:paymentId/events`; the API validates each state transition, and a final `SETTLED` state requires verification of the onchain transaction and receipt/log. A browser-reported transient state cannot overwrite a verified final state.

When x402 returns `settlement_pending`, the response must contain a transaction hash and network. The client or reconciliation service checks that transaction before creating any new authorization. While the outcome is unknown, RepuGate returns the pending state and never signs a new nonce merely because an HTTP/RPC timeout occurred. When the provider supports the official payment-identifier extension, the same identifier is attached to retries so the provider and facilitator can return a cached result.

### 7.10 Delivery Receipt and Audit Record

After a successful response, an optional signed delivery receipt may bind the settled payment to hashes of the exact request and response. It proves which bytes were returned, not that an AI answer was correct, useful, or honest. Negative feedback must not require a provider-issued receipt that a malicious provider could simply withhold.

Each assessment stores enough information for explanation and evaluation:

- service identity
- identity epoch
- exact offer hash and policy hash
- evaluation grant ID and payment ID
- requested payment amount
- raw score
- verified score
- confidence
- accepted and rejected feedback counts
- detected risk flags
- final decision
- block number and data freshness
- payment state, authorization nonce, transaction hash, and transfer-log index when available
- latency

## 8. Reputation Models and Baselines

The baselines compare how reputation evidence changes the payment decision.
They must be separated from RepuGate's shared payment controls. B1, B2, and B3
all run inside the same pipeline, which independently checks the canonical
offer, identity binding, user budget, Wallet chain, one-use Grant, redirect
policy, and payment state. Therefore, an offer-substitution result shared by
B1/B2/B3 demonstrates the common gateway, not a superior B3 scoring formula.

### Current Scoring Scope

The implemented scorer intentionally evaluates one semantic reputation
dimension: `tag1 = quality`, represented on a documented 0–100 scale.
Deterministic scenarios additionally require `tag2 = inference` to identify
the AI-inference service subtype. `inference` is a scope filter, not a second
numeric dimension.

This boundary is a project design choice, not a limitation of ERC-8004. It
keeps the B1/B2/B3 comparison controlled: all baselines estimate the same
property, while the independent variable is how feedback is validated and
aggregated. Identity binding, payment validity, reviewer diversity, and
confidence are evidence or risk signals and therefore remain separate from
the quality score.

Latency, uptime, success rate, price, and revenue have different units,
directions, and meanings. Combining them directly with quality would produce
an arbitrary composite score and make experimental conclusions difficult to
interpret. A future multidimensional model should define and normalize each
dimension separately, expose per-dimension results, and only combine them
through an explicit policy with declared weights. Section 15.1 describes
compatible extensions to evidence weighting within the current quality
dimension.

### B0: No Gate (Reference Baseline, Not Yet Implemented)

**Purpose.** B0 measures what happens when the Buyer uses x402 payment-protocol
checks but no ERC-8004 trust decision.

**Input and calculation.** B0 reads no identity or feedback, calculates no
score or confidence, and performs no evidence verification. For a fair future
implementation it should retain basic protocol controls—runtime schema parsing,
supported scheme/network/asset selection, budget and timeout caps, and Wallet
chain matching—but skip reputation evaluation and reputation-bound Grant
issuance.

**Decision.** A syntactically valid offer inside the Buyer's configured payment
limits is paid. A Provider with no reputation or actively manipulated
reputation is treated exactly like an honest Provider.

**Attack coverage.** B0 can reject malformed or unsupported payment requests
and over-budget offers through the protocol layer. It does not address
ungrounded feedback, receipt replay, reviewer concentration, paid Sybil
self-review, collusion, identity whitewashing, or service trustworthiness. It
also has no reputation decision to bind to a one-use EvaluationGrant.

**Implementation status.** B0 remains a target baseline for the expanded report
experiment. The current Presentation runner executes B1, B2, B3-Beta, and
B3-Dirichlet; B0 remains unimplemented.

### B1: Raw ERC-8004 Reputation

**Purpose.** B1 represents the naive use of raw ERC-8004 reputation and shows
why the existence of onchain feedback is not itself proof of a real service
interaction.

**Input validation.** B1 keeps feedback only when it refers to the selected
Agent, is not revoked, matches the configured `quality`/service tags and
registered endpoint, and contains a score in the supported 0–100 range. It does
not require proof of payment.

**Score.** Each accepted feedback record has equal weight:

```text
B1 score = arithmetic mean of all accepted raw feedback scores
```

Distinct reviewer count and `confidence` are reported as diagnostics, but the
B1 policy does not use confidence to gate payment.

**Attack coverage.** B1 removes revoked, malformed, wrong-Agent, wrong-tag, and
wrong-endpoint feedback. It does not stop an attacker from creating ungrounded
ratings, attaching one receipt to many ratings, submitting many ratings from
one address, or distributing ratings across Sybil wallets. In the fixed
fixtures, B1 allows ungrounded feedback, receipt replay, and reviewer
concentration. Offer mismatch is blocked only by the shared exact-offer gate.

### B2: Payment-Grounded Reputation

**Purpose.** B2 asks whether each rating can be grounded in one real, unique,
service-bound payment before the rating affects reputation.

**Evidence checks.** B2 starts with the same scoped feedback as B1, then accepts
a record only when all of the following hold:

- a payment proof exists and the verifier returns a valid receipt
- claimed chain, transaction hash, log index, payer, recipient, and optional
  authorization nonce match the verified evidence
- the receipt payer equals the ERC-8004 feedback `clientAddress`
- the recipient equals the service identity's `agentWallet`
- the payment belongs to the current Identity Epoch
- settlement occurred no later than the feedback observation block
- the verified amount is positive
- neither receipt key nor authorization nonce was claimed by another feedback
  record in the current batch or by the injected receipt-use reader

**Score.** Every accepted payment-grounded feedback record still has equal
weight:

```text
B2 score = arithmetic mean of all accepted payment-grounded record scores
```

Reviewer diversity and confidence remain diagnostic and do not gate B2.

**Attack coverage.** B2 addresses feedback without payment, invalid or
mismatched payment proofs, receipt/nonce replay, wrong-payer reviews,
wrong-recipient payments, payments bound to another Identity Epoch, and
cross-service reuse when the service identity/recipient binding differs. It
does not stop one reviewer from making many unique valid payments and thereby
creating many equal-weight ratings. It also does not prove that different
wallets are independent, so funded Sybil wallets, self-payments, and collusion
remain possible. In the fixed fixtures, B2 blocks ungrounded feedback and
receipt replay but allows reviewer concentration.

### B3-Beta: Bayesian RepuGate (Implemented)

**Purpose.** `B3_REPUGATE` adds per-reviewer influence capping and a Bayesian cold-start
model to B2. It gives a small evidence set an explicit prior instead of treating
an arithmetic mean as equally reliable at every sample size.

**Evidence checks.** B3 accepts exactly the same payment-grounded records as B2.

**Reviewer evidence units.** B3 first groups accepted records by
case-insensitive reviewer address. Each reviewer contributes one normalized
evidence unit, regardless of how many valid payments and ratings that address
created:

```text
x_r = mean(valid scores submitted by reviewer r) / 100
0 <= x_r <= 1
n   = number of distinct verified reviewers
```

**Bayesian score.** The model uses a uniform `Beta(1,1)` prior. A continuous
reviewer score contributes `x_r` positive evidence and `1 - x_r` negative
evidence:

```text
alpha = 1 + sum(x_r)
beta  = 1 + sum(1 - x_r)
B3-Beta score = alpha / (alpha + beta)
```

The implementation remains deterministic and floating-point-free. If
`reviewerScoreBps(r)` is each reviewer's rounded 0–10,000 mean, then:

```text
B3-Beta scoreBps = roundHalfUp((10,000 + sum(reviewerScoreBps(r))) / (n + 2))
confidenceBps = floor(n * 10,000 / (n + 2))
```

**Formula derivation and provenance.** Let `p` denote the unknown probability
of a satisfactory future interaction. The Beta posterior and its expectation
follow Jøsang and Ismail's
[*The Beta Reputation System*](https://sites.cc.gatech.edu/fac/Charles.Isbell/classes/reading/papers/josang/JI2002-Bled.pdf):

```text
p ~ Beta(alpha, beta)
E[p | evidence] = alpha / (alpha + beta)

alpha = alpha_0 + sum(x_r)
beta  = beta_0  + sum(1 - x_r)
alpha_0 = beta_0 = 1

therefore:
E[p | evidence] = (1 + sum(x_r)) / (n + 2)
```

The paper describes positive and negative feedback as continuous amounts. The
use of a normalized score as fractional positive/negative evidence is also
consistent with Jøsang, Luo, and Chen's
[*Continuous Ratings in Discrete Bayesian Reputation Systems*](https://dl.ifip.org/db/conf/ifiptm/ifiptm2008/JosangLC08.pdf).
The following are explicit **RepuGate design choices**, rather than formulas
claimed verbatim from either paper: using a `Beta(1,1)` prior; first collapsing
all records from one wallet into one reviewer mean; requiring payment-grounded
evidence; and defining `confidence = n/(n+2)` as the fraction of posterior mass
provided by observed reviewer evidence. This distinction is important because
the confidence value is an engineering evidence-strength indicator, not a
Bayesian credible level or a probability that the decision is correct.

This is a continuous-rating adaptation of the Beta Reputation System. The
prior shrinks extreme scores from very small samples toward 50%. If `n = 0`,
RepuGate reports no score and zero confidence rather than presenting the prior
mean as measured reputation.

**Evidence confidence.** Confidence is the posterior evidence mass relative to
the total prior-plus-evidence mass:

```text
confidence = n / (n + 2)
```

The `2` is the strength of the `Beta(1,1)` prior, not a separately chosen
"full-confidence reviewer count." This value is an evidence-certainty signal,
not a claim that the score has that probability of being correct. B1 and B2
also report this signal as a diagnostic, using their respective distinct
in-scope and payment-grounded reviewer counts; only B3 gates `ALLOW` on it.
`LOW_DISTINCT_REVIEWER_COUNT` is emitted below three distinct reviewers, which
is also the minimum count that reaches the default 60% confidence threshold.

Five ratings from one reviewer therefore have the same aggregate influence as
one rating from that reviewer. B3 requires both posterior score and evidence
confidence to meet the `ALLOW` policy. The approved design contains:

- verified-interaction filtering inherited from B2
- one evidence unit per distinct reviewer
- a `Beta(1,1)` prior and posterior-mean reputation score
- posterior-strength confidence for cold-start handling

**Attack coverage.** B3 inherits all B2 protections and additionally reduces
same-wallet reviewer-concentration attacks, even when each repeated rating has
a unique valid payment. In the fixed concentration fixture, B2 computes
`(5×100 + 2×0) / 7 = 71.43%` and allows payment. Bayesian B3 first derives
reviewer evidence `[1, 0, 0]`, then computes `Beta(2,3)`, a 40% posterior score,
and 60% evidence confidence; the score remains below the policy threshold and
payment is blocked. In the honest `[80, 90, 100]` fixture, B3 derives
`Beta(3.7,1.3)`, producing a 74% score and 60% confidence, so the honest control
still passes the frozen thresholds.

**Limitations.** B3 is not full Sybil resistance. Its evidence units assume
that distinct verified wallets are meaningfully independent, which an attacker
can violate by funding multiple wallets and making real payments. Fractional
continuous ratings are an explicit modelling adaptation, not a claim that each
rating is a literal Bernoulli trial. B3 also does not detect common funding
sources, colluding reviewers, feedback bursts, identity whitewashing, or
dishonest reviews after genuine payment. Prior choice, thresholds, and attack
prevalence require sensitivity analysis. A posterior credible interval is a
planned report metric; it is not yet an implemented gate.

**Weighting rationale.** Payment amount is not weighted linearly: a Provider
can recover most funds from self-payments and would otherwise be able to buy
reputation cheaply. Distinct verified payers and one-unit reviewer evidence are
risk controls, not proofs of independent users; transaction timing and funding
concentration remain future extensions.

### B3-Dirichlet: Ordinal Bayesian Variant (Implemented)

**Purpose.** `B3_DIRICHLET` keeps the complete B3 security pipeline but models
ratings as an ordinal five-category distribution rather than reducing all
evidence to one Beta mean. Its categories and anchors are:

```text
Very Poor = 0     Poor = 25     Neutral = 50
Good = 75         Excellent = 100
```

**Fuzzy continuous evidence.** The same reviewer-level score `x_r` is mapped
linearly to the two adjacent categories. For example, a score of 80 contributes
0.8 evidence to `Good` and 0.2 to `Excellent`; 90 contributes 0.4 to `Good`
and 0.6 to `Excellent`. Every reviewer still contributes exactly one total
evidence unit.

**Prior and score.** The model uses a symmetric five-category Dirichlet prior
with total strength 2, so each category starts with mass 0.4. This matches the
total prior strength of `Beta(1,1)` and makes the cold-start comparison fair.
The reported score has a deliberately narrower meaning than a mean rating:

```text
alpha_k = 0.4 + sum(fuzzy reviewer evidence assigned to category k)
B3-Dirichlet score = P(next independent rating is Good or Excellent | evidence)
                   = (alpha_Good + alpha_Excellent) / sum(alpha_k)
confidence         = n / (n + 2)
```

For a reviewer score `x` between adjacent anchors `v_j` and `v_(j+1)`, the
implemented triangular membership is:

```text
mu_j(x)     = (v_(j+1) - x) / (v_(j+1) - v_j)
mu_(j+1)(x) = (x - v_j)     / (v_(j+1) - v_j)
sum_k mu_k(x) = 1
```

This model is grounded in Jøsang and Haller's
[*Dirichlet Reputation Systems*](https://doi.org/10.1109/ARES.2007.71), which
generalizes the binomial Beta model to multinomial rating levels. Mapping a
continuous rating into adjacent discrete levels with fuzzy membership follows
Jøsang, Luo, and Chen's
[*Continuous Ratings in Discrete Bayesian Reputation Systems*](https://dl.ifip.org/db/conf/ifiptm/ifiptm2008/JosangLC08.pdf).
The five anchors, symmetric total prior strength `C = 2` (`alpha_0,k = C/5 =
0.4`), reviewer-level capping, and the final
`P(Good) + P(Excellent)` gate score are **RepuGate design choices**. With
`m_(r,k) = mu_k(x_r)`, the implemented posterior predictive category
probability is:

```text
alpha_k = C/5 + sum_r m_(r,k)
P(L_k | evidence) = alpha_k / (C + n)
score = P(Good | evidence) + P(Excellent | evidence)
```

The common confidence formula is again the project-defined evidence fraction
`n/(C+n)`, not a credible interval from the Dirichlet paper.

The fixed-point implementation assigns 10,000 mass units to each reviewer and
4,000 prior units to each category. It reports no score when `n = 0`. In the
honest `[80, 90, 100]` fixture it produces 76% score and 60% confidence. In the
concentration fixture, reviewer evidence `[100, 0, 0]` produces 36% and 60%, so
the request is blocked. The same 70% score and 60% confidence `ALLOW` thresholds
are used for the frozen functional comparison.

**Interpretation and limitation.** B3-Beta estimates expected continuous
quality, while B3-Dirichlet estimates the probability of a `Good`-or-better
ordinal outcome. Their percentages answer different questions and should not
be ranked solely by which number is larger. Both variants inherit B2 evidence
checks, per-reviewer capping, and the same Sybil-independence limitations.

### Attack Coverage Summary

`✓` means the model directly addresses the attack, `partial` means it raises the
cost or covers only a constrained form, and `✗` means it does not address it.
Shared gateway controls are shown separately because they are not reputation
algorithm improvements.

| Attack or failure | B0 | B1 | B2 | B3-Beta | B3-Dirichlet | Reason |
| --- | --- | --- | --- | --- | --- | --- |
| Malformed, revoked, wrong-Agent/tag/endpoint feedback | N/A | ✓ | ✓ | ✓ | ✓ | B1 scope filtering is inherited by B2/B3 |
| High ratings without payment | ✗ | ✗ | ✓ | ✓ | ✓ | B2/B3 require verified payment evidence |
| One receipt or authorization nonce reused | ✗ | ✗ | ✓ | ✓ | ✓ | B2/B3 enforce receipt and nonce uniqueness |
| Wrong payer, recipient, or Identity Epoch | ✗ | ✗ | ✓ | ✓ | ✓ | B2/B3 bind evidence to reviewer and service identity |
| Many unique paid ratings from one wallet | ✗ | ✗ | ✗ | ✓ | ✓ | Both B3 variants give each reviewer one aggregate vote |
| High score from too few reviewers | ✗ | ✗ | ✗ | ✓ | ✓ | Both B3 variants use confidence as an ALLOW gate |
| Many funded Sybil wallets with real payments | ✗ | ✗ | ✗ | partial | partial | Payment raises cost, but wallet independence is not proven |
| Colluding reviewers or dishonest genuine customers | ✗ | ✗ | ✗ | ✗ | ✗ | Payment evidence does not prove review honesty |
| Offer/recipient/endpoint substitution | ✗ | shared gate | shared gate | shared gate | shared gate | Canonical offer and identity checks, not reputation scoring |
| EvaluationGrant replay or altered authorization | N/A | shared gate | shared gate | shared gate | shared gate | One-use Grant and field-by-field intent recheck |

### Deterministic Bayesian Fixture Outcomes

This table maps the implemented attack fixtures to both Bayesian B3 variants
and the frozen thresholds. B0 is omitted because it is not implemented in the
runner.

| Fixture | B1 | B2 | B3-Beta | B3-Dirichlet | Main reason |
| --- | --- | --- | --- | --- | --- |
| Honest | ALLOW | ALLOW | ALLOW (74%) | ALLOW (76%) | Valid, diverse, payment-grounded feedback |
| Ungrounded ratings | ALLOW | BLOCK | BLOCK | BLOCK | B1 accepts ratings without payment proof; B2/B3 reject them |
| Receipt replay | ALLOW | BLOCK | BLOCK (36.7%) | BLOCK (26.7%) | B2/B3 admit only one rating for the reused receipt |
| Reviewer concentration | ALLOW | ALLOW | BLOCK (40%) | BLOCK (36%) | B3 removes same-wallet multiplicity and then fails its score gate |
| Expected-offer mismatch | BLOCK | BLOCK | BLOCK | BLOCK | The common canonical-offer gate blocks before payment, independently of reputation score |

### Approved Bayesian Decision Policy

The Bayesian implementation versions the policy as
`repugate-policy-v2-bayesian` so a Grant cannot silently reuse the meaning of a
v1 `policyHash`. The approved thresholds are:

```text
ALLOW score threshold       70% (7,000 bps)
REVIEW score threshold      50% (5,000 bps)
B3 ALLOW confidence         60% (6,000 bps)
Bayesian priors             Beta(1,1); symmetric Dirichlet(0.4 × 5)
confidence                  n / (n + 2), where n is the distinct reviewer count
```

B1 and B2 use the score thresholds; their confidence is diagnostic only. Both B3 variants
requires both score and confidence for `ALLOW`. A score of at least 70% with
insufficient B3 confidence returns `REVIEW`; a score below 50% returns `BLOCK`.
Any identity or exact-offer binding failure is a hard `BLOCK` for all four
implemented models. The policy parameters and semantic version are included in
`policyHash`.

The code and generated Presentation artifact implement both Bayesian variants
under the v2 policy hash semantics.

## 9. Threat Model

### 9.1 Protected Assets

- funds controlled by the paying Agent
- correctness of the automatic payment decision
- integrity of the calculated reputation score
- uniqueness and service binding of payment evidence
- exact binding between the evaluated offer and signed authorization
- idempotent handling of uncertain settlement
- explainability of the final decision

### 9.2 Adversaries

The project considers malicious x402 service providers, malicious reviewers, and collusion between them.

An adversary may:

- create multiple EVM wallets
- register multiple ERC-8004 identities
- submit arbitrary feedback
- submit feedback without purchasing a service
- replay an existing payment receipt
- use a receipt from one service to review another service
- perform low-value self-payments through Sybil wallets
- coordinate multiple reviewer wallets
- change metadata, endpoint, or wallet information under its control
- abandon a low-reputation identity and register a new one
- observe public blockchain data
- know the RepuGate scoring policy
- change a quoted amount, token, recipient, endpoint, or identity after evaluation
- return cross-origin redirects or inconsistent x402 offers
- delay responses or create ambiguous settlement timeouts
- host malicious, oversized, or internal-network-targeting `feedbackURI` content

The Buyer Agent may make an incorrect decision because of model error or prompt injection, but it can invoke only the typed trusted-payment capability exposed by the application.

### 9.3 Trust Assumptions

The course prototype assumes that:

- the Agent wallet protects its private key
- the local RepuGate implementation is not compromised
- the pinned ERC-8004 contracts behave according to their source code
- finalized blockchain state is correct
- the selected RPC returns correct chain data
- in Live mode, the selected x402 facilitator and chain adapter correctly verify signatures and settlement; deterministic mode performs structural validation and simulated settlement only
- standard cryptographic primitives remain secure
- untrusted JavaScript cannot execute in the Presentation Web App's trusted origin

The ERC-8004 feedback, feedback documents, service-provided metadata, service API responses, and unconfirmed transactions are treated as untrusted.

### 9.4 Out-of-Scope Attacks

- wallet private-key compromise
- compromise of the user's host computer
- blockchain majority or consensus attacks
- cryptographic forgery
- direct compromise of trusted RPC infrastructure
- vulnerabilities in the underlying x402 or ERC-8004 contracts unrelated to the gateway
- proof that an AI-generated response is semantically correct
- globally preventing manual MetaMask payments or payments initiated outside RepuGate

### 9.5 Security Goals

- **G1 Payment Grounding**: ungrounded feedback must not affect verified reputation.
- **G2 Receipt Uniqueness**: one payment receipt must not influence reputation more than once.
- **G3 Service Binding**: payer, recipient, service identity, and endpoint must be consistent.
- **G4 Exact Offer Binding**: an approval for one offer must not authorize a different amount, asset, recipient, endpoint, identity epoch, or policy version.
- **G5 Idempotent Settlement**: retries and uncertain responses must not produce duplicate payments.
- **G6 Manipulation Resistance**: B3 should degrade more slowly than B1 as manipulated feedback increases.
- **G7 Safe Authorization**: insufficient or suspicious evidence must not result in unlimited automatic payment.
- **G8 Availability**: improved security must not be achieved by blocking all honest services.

## 10. Failure Handling

| Failure | Default course-prototype behaviour |
| --- | --- |
| ERC-8004 identity is missing | `REVIEW` or allow only a configured small trial payment |
| Endpoint or wallet does not match | `BLOCK` |
| Signed offer is invalid or does not match `accepts[]` | `BLOCK` |
| Offer hash, buyer, policy, or identity epoch does not match the grant | `BLOCK` and re-evaluate |
| Evaluation grant expired or was already consumed | Re-evaluate; never reuse it |
| RPC is unavailable | Do not automatically authorize a payment above the low-risk cap |
| Feedback document is unavailable or malformed | Exclude that feedback item |
| Feedback URI targets a disallowed/private address | Do not fetch it; exclude and record a safety flag |
| Transaction is not sufficiently confirmed | Wait or return `REVIEW` |
| Settlement is pending with a transaction hash | Reconcile that transaction; do not create a new authorization |
| Receipt was previously consumed | Exclude it and record a replay flag |
| Feedback sample is too small | Reduce confidence and apply cold-start policy |
| Cached data is stale | Refresh from the chain before an automatic payment |
| Requested amount exceeds the user cap | `BLOCK` |
| Service identity metadata changes | Create a new identity epoch and require reassessment |
| Paid request redirects to another origin | Block by default or restart evaluation for the final origin |

## 11. Data and Storage

SQLite is sufficient for the course prototype. It stores derived and local state, not private keys.

Suggested logical tables:

- `agents`
- `identity_epochs`
- `feedback`
- `feedback_evidence`
- `receipt_uses`
- `trust_assessments`
- `decisions`
- `evaluation_grants`
- `payment_attempts`
- `experiment_runs`

`receipt_uses` has a unique constraint on `(chain_id, transaction_hash, log_index)` and also records the authorization nonce when available. Grant consumption and evidence ingestion use database transactions so concurrent requests cannot consume a grant or receipt twice.

`payment_attempts` stores the stable payment identifier, offer hash, authorization nonce, transaction hash, network, current state, and timestamps required for reconciliation. It never stores a private key or wallet secret.

Cached chain-derived records should include the source block number so their freshness can be checked.

Request privacy is minimized: audit records store a normalized origin/path hash and selected payment fields, not query strings, request bodies, authorization headers, or wallet secrets.

## 12. Evaluation Design

### 12.1 Research Questions

- **RQ1**: Does payment-receipt verification reject feedback without a real service payment?
- **RQ2**: Does RepuGate reduce payments to manipulated services compared with raw ERC-8004 reputation?
- **RQ3**: How does RepuGate affect honest-service acceptance, cold start, and user review burden?
- **RQ4**: What latency, RPC, and gas overhead does RepuGate introduce?
- **RQ5**: Do offer-bound grants and idempotent reconciliation prevent offer substitution and duplicate payment under retry failures?

The current deterministic Presentation fixtures directly exercise RQ1, RQ2,
and the exact-offer-binding portion of RQ5. RQ3, RQ4, and statistical retry
measurements remain report-scale evaluation work.

### 12.2 Attacks

The current Presentation experiment runner implements four fixed adversarial
fixtures:

1. feedback without payment
2. payment-receipt replay
3. reviewer concentration
4. an offered amount that differs from the trusted catalog's expected offer

The fourth fixture is an expected-offer mismatch detected during evaluation; it
does not claim that the independent Provider changed its offer after an
`ALLOW`. Post-submission network uncertainty and one-use Grant behaviour are
covered by deterministic Client/API tests, but are not aggregated as experiment
rows.

Expanded report experiments may include:

5. cross-service receipt reuse
6. provider-side substitution after an initial `ALLOW`
7. settlement timeout followed by a duplicate retry attempt
8. paid Sybil self-review
9. colluding reviewers
10. burst feedback
11. identity whitewashing
12. endpoint or wallet replacement

### 12.3 Metrics

The current JSON/CSV artifact records, for every model/scenario pair:

- decision and whether payment was authorized
- raw score, verified score, and confidence
- distinct reviewer count
- accepted and rejected feedback counts
- reputation and exact-offer risk flags

It summarizes honest-scenario allow rate and adversarial-fixture allow rate for
each model. The current `75% / 25% / 0% / 0%` adversarial allow rates mean only
that B1/B2/B3-Beta/B3-Dirichlet allow `3 / 1 / 0 / 0` of the four fixed
fixtures; they are not population estimates.

The following are planned report-scale metrics and are not emitted by the
current runner: false-rejection confidence intervals, invalid-feedback and
replay acceptance rates over generated samples, duplicate-payment rate, score
inflation curves, attack cost, manual-review rate, cold-start interactions,
P50/P95/P99 latency, RPC calls, and gas cost.

The Bayesian report evaluation must include a pre-declared sensitivity sweep
over at least `Beta(0.5,0.5)`, `Beta(1,1)`, and `Beta(2,2)` priors; alternative
symmetric Dirichlet prior strengths; and 50%, 60%, and 70% confidence
thresholds. The selected configuration is fixed on a development set before
evaluating held-out scenarios, so the prior and policy are not chosen after
observing the final attack results.

### 12.4 Fair Comparison

B1, B2, and both B3 variants must be compared at the same or similar
honest-service approval rate. Otherwise, a system could appear safe merely by
blocking most requests.

The main comparison is:

```text
At the same honest-service approval rate:
1. does B2 reduce ungrounded and replay-based payments relative to B1?
2. do both B3 variants reduce reviewer-concentration payments relative to B2?
3. how do the Beta expected-quality and Dirichlet Good-or-better semantics
   behave across honest, cold-start, and adversarial score distributions?
```

The current Presentation comparison is a deterministic functional benchmark:
all models receive the same fixture and frozen policy; the configuration hash
and raw JSON/CSV are saved; and all four models allow the single honest control
fixture. Because it contains one honest fixture, four adversarial fixtures, no
random sampling, and one execution per pair, it does not support confidence
intervals or general population claims.

If the final report makes statistical claims, the expanded experiment should
use generated development/evaluation sets, fixed random seeds, multiple
repetitions, confidence intervals, and parameter-sensitivity analysis. Honest
approval should be matched across models, and raw results must remain
reproducible.

### 12.5 Controlled Testbed

The following is a possible future report-scale testbed, not the currently
implemented dataset:

```text
10 honest services
5 malicious services
100 normal reviewer wallets
100 Sybil wallets
5,000 simulated interactions
20 repetitions per configuration
```

The implemented Presentation dataset contains one honest control and four
adversarial fixtures, evaluated once under B1, B2, B3-Beta, and B3-Dirichlet
for 20 result rows.

## 13. Presentation MVP

The presentation prototype prioritizes one stable, complete vertical slice:

- one Buyer Agent integrated into the Presentation Web App
- one configurable x402 Provider
- one frozen ERC-8004-style service identity with controlled honest and adversarial evidence profiles
- fixture identity and feedback loading through the same Core ports intended for a later onchain adapter
- x402 `402 Payment Required` handling
- exact offer hashing and a one-use EvaluationGrant
- guarded WalletPort authorization using FakeWallet in deterministic mode; MetaMask remains a Live-mode adapter
- a payment identifier and settlement state display
- B1 raw reputation
- B2 payment-grounded reputation
- B3-Beta posterior-mean scoring with reviewer-level aggregation and a confidence gate
- B3-Dirichlet Good-or-better posterior-predictive scoring over five ordinal categories
- `ALLOW` and `BLOCK` decisions
- feedback-without-payment attack
- receipt-replay attack
- reviewer-concentration attack
- offer-substitution attack
- four-model comparison cards and attack matrix generated from frozen experiment data
- one deterministic simulated payment flow, with a Base Sepolia Live flow added when ready
- one browser-based demonstration page
- a Service Explorer, Trust Evaluation view, and Attack Lab
- deterministic demo data that does not require live testnet access

The core demonstration is:

```text
A malicious service receives many ungrounded high ratings.
B1 calculates a high score and allows payment.
RepuGate rejects the ungrounded or replayed feedback.
The verified score falls and RepuGate blocks payment.

An honest service has valid payment-grounded feedback.
RepuGate allows the payment and the x402 request succeeds.
```

The presentation must label simulated scenarios and hypothetical values clearly. It must not present invented values as measured results.

## 14. Proposed Repository Structure

```text
RepuGate/
├── apps/
│   ├── web/                       # Presentation UI + in-app Buyer Agent
│   │   └── src/
│   │       ├── agent/             # Agent Controller; TrustedPaymentPort only
│   │       ├── pages/             # Explorer / Evaluation / Attack Lab
│   │       ├── wallet/            # private MetaMask WalletPort adapter
│   │       └── api/
│   ├── api/                       # RepuGate Evaluation API
│   │   └── src/
│   │       ├── routes/            # evaluate / grants / payments / results
│   │       ├── services/          # identity, evidence, grant, reconciliation
│   │       └── adapters/          # ERC-8004 / EVM / SQLite
│   └── provider/                  # configurable demo x402 payee/service
├── packages/
│   ├── core/                      # pure scoring, schemas, canonicalisation, grant, epoch, state logic
│   ├── client/                    # trustedFetch + GuardedPaymentClient
│   └── x402/                      # shared wire headers, codec, schemas, and payload types
├── experiments/                  # B1/B2/B3, attack scenarios, and CLI runner
├── contracts/
│   └── MockEIP3009USDC.sol        # optional local protocol-test support
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── e2e/
├── data/
│   ├── fixtures/
│   └── results/
├── slides/
├── design.md
├── design.zh-CN.md
└── README.md
```

This is a logical structure, not a requirement to create every file at project start. The implementation should begin with the smallest end-to-end flow and add modules only when they support the research question or evaluation.

The fixed dependency direction is `web -> client -> {core, x402}`, `api -> core`, `experiments -> core`, and `provider -> {core, x402}`. `core` does not depend on React, HTTP, SQLite, or an application directory, and the Provider remains operationally independent. Domain DTOs and rules live in `core`; x402 wire constants, schemas, and payload types live in the narrowly scoped `packages/x402` protocol package rather than a generic shared package. See [`code-architecture.md`](./code-architecture.md) for concrete file responsibilities, interfaces, and call contracts.

## 15. Future Work and Scope Boundaries

### 15.1 Future Reputation Extensions

As defined in Section 8, the implemented scorer currently evaluates only the
`quality` dimension. The following work extends evidence processing within
that controlled scope.

Two compatible extensions are deferred for future work. Both would change how
evidence is weighted **within the same quality dimension**, rather than adding
new dimensions:

1. **Reviewer trust weighting.** Assign each reviewer a transparent weight
   `w_r` derived from evidence independent of the target Agent's current score,
   such as verified interaction history, account age, funding-cluster risk, a
   trusted-signal-provider allowlist, or an EigenTrust/OpenRank-style trust
   graph. B3-Beta could update with `w_r*x_r` positive and
   `w_r*(1-x_r)` negative evidence; B3-Dirichlet could add
   `w_r*mu_k(x_r)` to category `k`. Weights must be capped and auditable to
   reduce centralization and circular-reputation risks. Evaluation would need a
   reviewer graph or labelled reviewer dataset, trusted-seed sensitivity tests,
   and funded multi-wallet Sybil attacks.

2. **Time decay.** Multiply reviewer evidence by a recency weight such as
   `w_time = 2^(-age/halfLife)`, so evidence loses half its influence after the
   pre-declared half-life. This can respond to endpoint, model, or service-
   quality changes, but may amplify coordinated recent-review bursts. The
   half-life must be selected on development data and tested through a
   sensitivity sweep rather than tuned on final attack results.

If both extensions are used, a capped combined weight could be
`w_r = w_trust * w_time`. The current confidence `n/(n+2)` could not be reused
unchanged: weighted evidence would require a declared effective evidence mass,
for example `sum(w_r)`, or an effective sample-size estimator, together with
new calibration. These extensions are not implemented and are not part of the
current security claims.

### 15.2 Current Out-of-Scope Components

The following components are intentionally excluded from the initial design:

- a standalone blockchain indexer
- a custom x402 facilitator
- a custom interaction-receipt smart contract
- real local settlement for the presentation milestone; local mode uses fixtures/mocks and Live mode uses Base Sepolia
- production Merkle/EAS anchoring for delivery receipts
- a traditional HTTP forward proxy
- multiple provider applications
- a production administration dashboard beyond the focused presentation web app
- multi-chain abstractions
- machine-learning-based Sybil detection
- escrow and dispute contracts
- ERC-4337 or smart-account policy modules

These components add substantial implementation cost without being necessary to answer the initial research question.

## 16. Expected Deliverables

- working source repository
- clear installation and execution instructions
- deterministic local demo
- interactive browser-based presentation platform
- optional public-testnet demonstration
- B1/B2/B3-Beta/B3-Dirichlet Presentation baselines, with B0 added for the expanded report experiment
- at least three reproducible attack scenarios
- saved experiment configurations and result files
- scripts that regenerate result tables or graphs
- unit, adapter, and end-to-end tests
- eight-slide presentation
- final course report
- recorded backup demonstration
- limitations and trust assumptions documented explicitly

## 17. Current Decisions

The following decisions are considered fixed unless implementation evidence requires a change:

- client-side `trustedFetch()` middleware
- the Buyer Agent is embedded in the Presentation Web App, not a separate application
- a deterministic scripted Buyer Agent for the presentation; an LLM is only an optional later explanation layer
- the Agent receives only `TrustedPaymentPort`; raw wallet methods are not part of its capability set
- signing remains behind WalletPort and outside the Evaluation API; deterministic mode uses FakeWallet and Live mode will use MetaMask
- lower-level x402 offer selection remains under RepuGate control
- every automatic payment requires an exact-offer-bound, short-lived, one-use `EvaluationGrant`
- identity reputation is scoped by `IdentityEpoch`
- payment identifiers and settlement reconciliation prevent blind retries
- Core logic is separated from external adapters
- EVM-only prototype
- x402 v2 `exact` scope
- isolated fixture/mock state for deterministic experiments
- Base Sepolia for the optional Live demonstration, using test assets only
- SQLite for cache, replay tracking, and decision logs
- the Evaluation API is the sole persistent writer of payment state
- experiments and the live demo use separate databases or result directories
- one independent configurable Demo Provider process with simulated settlement
- distinct ERC-8004 identities, endpoints, and payee configurations for the Honest and Malicious services
- React/Vite presentation web app with deterministic and optional live modes
- TypeScript, Node.js, viem, SQLite, Vitest, and a pnpm workspace
- B1/B2/B3-Beta/B3-Dirichlet as the core presentation comparison, with ungrounded-feedback, receipt-replay, reviewer-concentration, and offer-substitution attacks
- payment-grounded and reviewer-concentration-aware claims
- no claim of complete Sybil resistance
- no claim that payment or a signed delivery receipt proves semantic output quality
- security enforcement is application-scoped, not wallet-global

## 18. References

- ERC-8004: <https://eips.ethereum.org/EIPS/eip-8004>
- x402 documentation: <https://docs.x402.org/>
- x402 v2 specification: <https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md>
- x402 Offer/Receipt extension: <https://github.com/x402-foundation/x402/blob/main/specs/extensions/extension-offer-and-receipt.md>
- x402 Payment-Identifier extension: <https://github.com/x402-foundation/x402/blob/main/typescript/packages/extensions/src/payment-identifier/README.md>
- ERC-8004 reputation best practices: <https://github.com/erc-8004/best-practices/blob/main/Reputation.md>
- MainStreet prior art: <https://github.com/philpof102-svg/mainstreet>
- AEGIS escrow prior art: <https://github.com/im-sham/aegis-protocol>
- Aegis signer-proxy prior art: <https://github.com/Animesh-Parashar/Aegis-Protocol>
- x402-receipts prior art: <https://github.com/StelarDigital/x402-receipts>
- Known offer/receipt binding limitation: <https://github.com/x402-foundation/x402/issues/3006>
- Jøsang and Ismail, *The Beta Reputation System* (2002): <https://sites.cc.gatech.edu/fac/Charles.Isbell/classes/reading/papers/josang/JI2002-Bled.pdf>
- Jøsang, Luo, and Chen, *Continuous Ratings in Discrete Bayesian Reputation Systems* (2008): <https://dl.ifip.org/db/conf/ifiptm/ifiptm2008/JosangLC08.pdf>
- Jøsang and Haller, *Dirichlet Reputation Systems* (2007): <https://doi.org/10.1109/ARES.2007.71>
