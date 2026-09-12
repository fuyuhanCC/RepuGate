# RepuGate 代码架构

> 本文把 `design.zh-CN.md` 中的系统设计落实为可编码的 TypeScript workspace、模块边界、接口契约和调用关系。本文不包含业务实现。

## 1. 架构目标

代码架构需要同时满足以下目标：

1. 展示平台能够运行完整的 `服务发现 → 信任评估 → ALLOW/BLOCK → 钱包授权 → x402 响应` 流程。
2. B1 和 B3 必须调用与 Demo 相同的评分和策略代码，不能另写一套“实验版算法”。
3. 确定性 Demo、实验和 Base Sepolia Live 模式通过 Adapter 切换，Core 不感知数据来自 fixture、SQLite 还是 RPC。
4. Agent 只能获得受限的 `TrustedPaymentPort`，不能直接获得 MetaMask 或任意签名能力。
5. 报价选择、报价哈希、Grant 消费和付款状态都只有一个权威实现。
6. 外部数据在进入 Core 前必须通过运行时 Schema 验证。

## 2. Workspace 结构

```text
RepuGate/
├── apps/
│   ├── web/
│   │   ├── src/
│   │   │   ├── app/                    # Router、providers、全局错误边界
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
│   │   │   ├── routes/                 # HTTP 输入、Schema 验证、响应映射
│   │   │   ├── application/            # API use cases 与事务边界
│   │   │   ├── adapters/
│   │   │   │   ├── erc8004/            # viem 与 fixture 实现
│   │   │   │   ├── evidence/           # receipt/Transfer 验证
│   │   │   │   ├── persistence/        # SQLite repositories
│   │   │   │   └── clock/              # system/fixed clock
│   │   │   ├── config/
│   │   │   ├── app.ts                  # 构造依赖并创建 HTTP app
│   │   │   └── server.ts               # 唯一 listen 入口
│   │   └── migrations/
│   └── provider/
│       └── src/
│           ├── routes/                  # honest、malicious 服务路由
│           ├── behaviours/              # 正常、报价替换等行为
│           ├── x402/                    # 官方 x402 server SDK adapter
│           ├── catalog.ts               # 服务身份和 endpoint 配置
│           ├── app.ts
│           └── server.ts
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── domain/                  # 领域类型与不变量
│   │       ├── schemas/                 # 跨边界 DTO runtime schemas
│   │       ├── canonicalization/        # offer/request/identity hashes
│   │       ├── reputation/              # B1、B2、B3 评分
│   │       ├── policy/                  # ALLOW/REVIEW/BLOCK
│   │       ├── evaluation/              # 共享评估 use case
│   │       ├── grants/                  # Grant 纯校验规则
│   │       ├── payments/                # 付款状态 reducer
│   │       ├── ports/                   # 外部能力接口
│   │       ├── errors/
│   │       └── index.ts
│   └── client/
│       └── src/
│           ├── trustedFetch.ts
│           ├── offerSelector.ts
│           ├── guardedPaymentClient.ts
│           ├── x402ClientAdapter.ts
│           ├── ports.ts
│           └── index.ts
├── experiments/
│   └── src/
│       ├── scenarios/                   # ungrounded/replay/substitution
│       ├── baselines/                   # B1/B3 运行配置
│       ├── fixtures/
│       ├── metrics/
│       ├── run.ts
│       └── exportResults.ts
├── contracts/
│   └── MockEIP3009USDC.sol              # 可选的本地协议测试支持
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── e2e/
├── data/
│   ├── fixtures/                        # 版本控制中的确定性输入
│   └── results/                         # 冻结的 Presentation 结果
├── var/                                 # 本地 SQLite/日志；不提交 Git
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── package.json
└── .env.example
```

`contracts/` 在 Presentation MVP 中不是前置依赖。只有需要验证本地 EIP-3009 行为时才实现该合约。

## 3. 固定依赖方向

```text
apps/web ───────→ packages/client ───→ packages/core
    │                                      ↑
    └──────── HTTP ───────→ apps/api ──────┤
                                           │
apps/provider ───────── schema only ───────┤
experiments ───────────────────────────────┘

apps/api adapters ──→ RPC / ERC-8004 / SQLite
apps/provider x402 ─→ Facilitator / Base Sepolia
packages/client ────→ MetaMask / target Provider
```

必须遵守以下规则：

- `core` 不导入 React、Express/Fastify、SQLite、Node 文件系统或具体 RPC client。
- `client` 不导入 React，也不直接访问 API 数据库。
- `web` 只能通过 `packages/client` 进入付款流程，不能自己构造签名请求。
- `api` 不导入 `web` 或 `client`。
- `experiments` 直接调用共享 evaluator，不通过网页，也不复制评分算法。
- `provider` 只从 `core` 复用公开 Schema/类型，不导入评估或策略代码。
- 每个 package 只通过 `index.ts` 或明确的 subpath export 暴露公共 API，禁止跨包导入内部文件。

## 4. `packages/core`：唯一业务规则来源

### 4.1 Domain 类型

核心类型保持与框架无关：

```ts
type Decision = "ALLOW" | "REVIEW" | "BLOCK";
type Baseline = "B1_RAW" | "B2_GROUNDED" | "B3_REPUGATE";

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

金额始终使用 token 最小单位的 `bigint`；数据库和 JSON 边界使用十进制字符串，禁止使用浮点数表示资产。

### 4.2 运行时 Schema

TypeScript 类型不会验证网络输入。因此下列对象必须有运行时 Schema：

- `PaymentRequired`
- `repugate-agent` extension
- `/api/evaluations` 请求与响应
- `EvaluationGrant`
- payment event
- experiment result
- ERC-8004 registration file 和 feedback document

Schema 负责结构与格式检查，Domain constructor 负责业务不变量。HTTP route 不应手写重复校验。

### 4.3 Canonicalization

`canonicalization/offer.ts` 是准确报价哈希的唯一实现：

1. HTTP method 转大写。
2. URL 使用 WHATWG URL 解析，移除 fragment，规范化 host、default port 和 path。
3. EVM 地址规范化后按地址值编码，而不是按原始字符串编码。
4. network 使用规范化 CAIP-2 字符串。
5. amount 使用无符号整数最小单位。
6. request body 先在客户端计算 hash；Core 和 API 不保存原始敏感内容。
7. 所有字段以固定顺序 ABI encode，再计算 keccak256。

输出至少包括：

```ts
interface CanonicalizedOffer {
  offer: CanonicalOffer;
  encodedOffer: `0x${string}`;
  offerHash: `0x${string}`;
}
```

同一输入必须在 Web、API、实验和测试 golden vector 中产生完全相同的 hash。

### 4.4 共享评估 Use Case

`evaluation/evaluateOffer.ts` 是 Demo 和实验共同调用的核心入口：

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

其内部固定顺序为：

```text
验证并规范化报价
  → 解析 ERC-8004 身份
  → 计算 IdentityEpoch
  → 加载同一语义维度的 feedback
  → 验证付款证据与重复使用情况
  → 计算 B1/B2/B3 分数
  → 执行策略
  → 返回可解释 EvaluationResult
```

该函数不写数据库、不调用 MetaMask、不发送付款，也不签发 Grant。

### 4.5 Reputation 与 Policy 分离

`reputation` 只计算信号：

- raw score
- verified score
- confidence
- accepted/rejected feedback
- risk flags

`policy` 只把这些信号与付款上下文映射为决策：

```ts
interface PolicyInput {
  score: ReputationAssessment;
  amount: bigint;
  identityMatched: boolean;
  offerRiskFlags: string[];
  policy: PolicyConfig;
}
```

Policy 配置必须版本化并计算 `policyHash`。实验冻结参数后不得静默修改。

### 4.6 Grant 与付款状态纯规则

Core 定义但不持久化 Grant：

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

`payments/reducePaymentEvent.ts` 是付款状态转换的唯一规则来源。客户端发送事件，不直接设置状态。

```text
CREATED → AUTHORIZED → SUBMITTED → SETTLEMENT_PENDING → SETTLED
    └─────────────── 合法失败路径 ─────────────────────→ FAILED
```

## 5. `packages/client`：受门控的付款客户端

`packages/client` 暴露给 Web 的主要入口只有：

```ts
trustedFetch(input, dependencies): Promise<TrustedFetchResult>
```

内部组件职责：

- `offerSelector.ts`：按 network、scheme、asset、预算和 timeout 选择唯一 `accepts[]` 项。
- `x402ClientAdapter.ts`：隔离 `@x402/core`、`@x402/evm` 等官方 SDK 的具体 API。
- `guardedPaymentClient.ts`：消费 Grant、逐字段复核 authorized intent、调用 WalletPort、重新发送请求。
- `ports.ts`：定义 `WalletPort`、`EvaluationApiPort` 和可注入 `FetchPort`。

`WalletPort` 必须窄化：

```ts
interface WalletPort {
  getAddress(): Promise<`0x${string}`>;
  getChainId(): Promise<number>;
  signX402Authorization(intent: AuthorizedPaymentIntent): Promise<SignedPaymentPayload>;
}
```

不得暴露 `sendTransaction`、任意 `signTypedData` 或原始 `window.ethereum.request`。

## 6. `apps/api`：编排、事务和持久化

### 6.1 Route 层

Route 只做四件事：

1. 解析并验证请求。
2. 调用一个 application use case。
3. 把领域错误映射为稳定的 HTTP/error code。
4. 返回经过 Schema 验证的 DTO。

Route 不实现评分、SQL、RPC 或状态转换规则。

### 6.2 Application Use Cases

建议的 use cases：

- `listServices`
- `evaluateAndIssueGrant`
- `getDecision`
- `consumeGrantAndCreatePayment`
- `recordPaymentEvent`
- `reconcileSettlement`
- `getPayment`
- `getLatestExperimentResult`

`evaluateAndIssueGrant` 调用 Core evaluator，并在同一数据库事务中保存 decision 和可选 Grant。只有 `ALLOW` 才签发 Grant。

`consumeGrantAndCreatePayment` 在同一事务中：

```text
读取 ISSUED Grant
  → 检查 expiry/buyer/offerHash/epoch/policyHash
  → compare-and-swap 为 CONSUMED
  → 创建 payment_attempt(CREATED)
  → 返回精确 AuthorizedPaymentIntent
```

因此同一个 Grant 的并发请求最多只有一个成功。

### 6.3 Adapter 接口

Core ports 至少包含：

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

每个端口提供两种实现：

- Live：viem RPC、ERC-8004 合约和安全 URI loader。
- Deterministic：版本控制中的 fixture、fixed clock 和预定义 receipt。

模式选择只发生在 `apps/api/src/app.ts` 的 composition root，不散落在业务代码中。

## 7. `apps/web`：展示与 Agent 控制器

页面按 feature 组织，不建立全局巨型 store。服务器状态通过 query hooks 管理；临时交互状态留在对应 feature。

### 7.1 Scripted Buyer Agent

脚本 Agent 负责把用户任务转成受限付款调用：

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

Agent 可以选择服务和预算，但不能自己把决策改成 `ALLOW`，也不能得到 WalletPort。

### 7.2 页面职责

- Service Explorer：只展示 catalog 与两种声誉分数。
- Trust Evaluation：驱动单次 `trustedFetch`，显示每个阶段、证据和错误。
- Attack Lab：读取冻结的结果 JSON，展示 B1/B3 图表，不在浏览器运行批量实验。

页面组件不直接调用 `fetch`、RPC 或 MetaMask；这些操作分别经过 API client、`trustedFetch` 和 WalletPort adapter。

## 8. `apps/provider`：一个应用，多个隔离身份

Provider 是单个进程，但至少暴露两个逻辑服务：

```text
GET/POST /services/honest/...
GET/POST /services/malicious/...
```

两者使用不同的：

- ERC-8004 `agentId`
- 注册 endpoint
- `agentWallet`/`payTo`
- fixture feedback set

恶意行为通过显式 strategy 注入，不使用散落的环境变量判断：

```ts
interface ProviderBehaviour {
  buildPaymentRequired(request: RequestContext): PaymentRequired;
  handlePaidRequest(request: PaidRequestContext): Promise<ServiceResponse>;
}
```

`HonestBehaviour` 返回稳定报价；`OfferSubstitutionBehaviour` 在复核阶段返回变化后的金额或收款地址。所有恶意场景必须有明确名称，便于测试和 PPT 解释。

官方 x402 SDK 只负责协议解析、付款 payload 和 facilitator 交互。`repugate-agent` extension 与具体 SDK 调用由 `provider/x402` adapter 封装，避免 SDK 版本变化扩散到业务模块。[官方 x402 仓库](https://github.com/x402-foundation/x402)目前将 TypeScript 能力拆分为 `@x402/core`、`@x402/evm`、`@x402/fetch` 和服务端框架包，本项目只引入实际需要的 EVM/HTTP 子集。

## 9. Experiments：复用真实 Core 的离线入口

实验 runner 不启动 Web，也不调用 Live API。它使用 fixture adapters 调用相同的 `evaluateOffer()`：

```text
scenario + seed
  → 生成服务、评价和 receipt fixtures
  → 对相同样本分别运行 B1 和 B3
  → 计算 malicious payment rate / honest approval rate / replay acceptance
  → 写入带 configHash 的 JSON/CSV
  → Attack Lab 只读展示
```

三个 Presentation 场景固定为：

1. `ungrounded-feedback`
2. `receipt-replay`
3. `offer-substitution`

报价替换主要是端到端安全测试，不应通过伪造评分结果来模拟。

## 10. HTTP API 契约

```text
GET  /api/services
POST /api/evaluations
GET  /api/evaluations/:decisionId
POST /api/grants/:grantId/consume
POST /api/payments/:paymentId/events
GET  /api/payments/:paymentId
POST /api/payments/:paymentId/reconcile
GET  /api/experiment-results/latest
```

关键约束：

- `/evaluations` 接收 canonical offer 所需原始字段，在 API 内再次规范化并与客户端 `offerHash` 对比。
- `/grants/:id/consume` 需要 buyer、offerHash、identityEpoch 和 policyHash；Grant ID 使用高熵随机值。
- `/payments/:id/events` 接收 `eventType`，不接受客户端直接提交 `state = SETTLED`。
- `settlement_received` 只表示收到 Provider 声明；API 验证交易后才生成 `settlement_verified`。
- mutation 请求携带 idempotency key。
- API error 使用稳定 code，UI 不依赖英文 message 做逻辑判断。

## 11. SQLite 数据所有权

建议的最小表：

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

重要唯一约束：

```text
evaluation_grants.id                         UNIQUE
payment_attempts.payment_id                  UNIQUE
payment_events(payment_id, idempotency_key) UNIQUE
used_receipts(chain_id, tx_hash, log_index) UNIQUE
used_receipts(chain_id, authorization_nonce) UNIQUE WHERE nonce IS NOT NULL
```

数据库只保存 body hash、payload hash 和必要的审计字段，不保存 MetaMask 私钥、seed phrase、完整敏感请求 body 或不必要的签名原文。

Demo 数据库和 experiment 数据库分开：

```text
var/demo.sqlite
var/experiments/<run-id>.sqlite
data/results/<run-id>.json
```

## 12. 错误模型和可观测性

统一错误结构：

```ts
interface ApiError {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

最少错误码：

- `UNSUPPORTED_OFFER`
- `IDENTITY_MISMATCH`
- `INSUFFICIENT_CONFIDENCE`
- `GRANT_EXPIRED`
- `GRANT_ALREADY_CONSUMED`
- `OFFER_CHANGED`
- `WALLET_REJECTED`
- `SETTLEMENT_PENDING`
- `SETTLEMENT_INVALID`

每条日志带 `requestId`；评估链路带 `decisionId`；付款链路带 `paymentId`。日志默认不输出 PAYMENT-SIGNATURE、原始 body 或完整反馈文件。

## 13. 测试架构

### Unit

- canonical offer golden vectors
- IdentityEpoch vectors
- B1/B3 score 与 confidence
- policy threshold boundary
- Grant expiry/mismatch
- payment event reducer

### Integration

- fixture adapters + Core evaluator
- SQLite 原子 Grant 消费
- receipt 唯一约束
- API Schema 和错误映射
- Provider 402/paid-response 流程

### Security

- 无付款评价不能进入 B3
- 同一 receipt/nonce 不能重复计分
- amount、asset、payTo、URL、body 或 identity 改变时 Grant 失效
- cross-origin redirect 默认拒绝
- pending settlement 不触发新 nonce

### E2E

- 使用 FakeWalletPort 的确定性完整流程
- Honest Provider 得到 `ALLOW` 并返回结果
- Malicious Provider 在 B1 下可能通过、在 B3 下被阻止
- MetaMask + Base Sepolia 作为独立手动 smoke test，不作为 CI 必需条件

## 14. Composition Root 与配置

所有实现选择集中在 `apps/api/src/app.ts`：

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

私密配置只存在于 server 进程环境变量。前端只能获得公开的 chain ID、合约地址和 API base URL。`.env.example` 只包含占位符。

## 15. 实现顺序

实现以纵向切片推进：

1. `core` 类型、Schema、canonicalization、B1/B3、policy 及 unit tests。
2. fixture adapters + `evaluateOffer()`，先生成确定性 B1/B3 结果。
3. API + SQLite，实现 decision、一次性 Grant 和 payment state。
4. Web + FakeWalletPort，完成无需测试网的端到端 Demo。
5. Provider + x402 client adapter，接入真实 `402` 流程。
6. MetaMask + Base Sepolia Live smoke test。
7. experiments 与 Attack Lab 图表，冻结 Presentation 数据。

任何新模块都必须能归入以上调用链；如果只增加文件数量而没有新的边界或可测试职责，则不创建。

## 16. 架构验收条件

开始扩展功能前，代码必须满足：

- Web 中不存在绕过 `trustedFetch` 的 Agent 付款路径。
- Core 可以在没有网络、数据库和 React 的情况下运行全部 unit tests。
- Demo 和 experiments 的 B3 都调用同一个 evaluator。
- 同一 Grant 并发消费只有一个成功。
- 客户端不能直接把 payment 标记为 `SETTLED`。
- 修改报价任一安全关键字段都会改变 `offerHash`。
- fixture 模式完全离线可运行，Live 模式故障不会破坏 Demo。
- Honest/Malicious 服务的身份和收款配置彼此隔离。
