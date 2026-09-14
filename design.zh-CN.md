# RepuGate 项目设计

## 1. 项目概述

**暂定项目名称**

> RepuGate：面向 x402 Agent 服务的支付凭证驱动型 ERC-8004 声誉网关

**项目定位**

RepuGate 是一个客户端侧信任中间件。AI Agent 在授权 x402 付款之前，RepuGate 会评估目标服务的 ERC-8004 身份、声誉和相关证据。

本项目研究以下问题：

> 当 ERC-8004 声誉评价可能被操纵时，AI Agent 应当如何判断是否向一个陌生的 x402 服务付款？

本项目只保护准备付款的 AI Agent，不负责保护服务提供方，也不试图构建通用区块链安全平台。

## 2. 项目动机

x402 允许 AI Agent 为 HTTP 资源付款，但付款验证不能证明资源提供方值得信任。ERC-8004 为 Agent 提供标准化的身份、声誉和验证记录，但原始评价仍可能包含垃圾信息或受到操纵。

RepuGate 将声誉证据与付款授权点连接起来：

```text
x402        回答：Agent 应当如何付款？
ERC-8004    提供：服务是谁，存在哪些评价？
RepuGate    决定：Agent 是否应当授权这笔付款？
```

本项目将 ERC-8004 评价视为不可信输入。RepuGate 先验证付款证据，再计算包含置信度的声誉分数，最后输出三种决策之一：

```text
ALLOW     Agent 可以自动授权付款
REVIEW    证据不足或风险中等，需要确认或限制金额
BLOCK     Agent 不应授权付款
```

## 3. 设计原则

1. **应用范围内的客户端门控**

   通过类似 `trustedFetch()` 的客户端中间件，在钱包授权之前执行付款决策。Buyer Agent 只能获得类型受限的付款能力，不能获得应用的通用钱包客户端。

2. **RepuGate 不保存私钥**

   签名始终保留在所选 `WalletPort` 内。确定性模式使用不含真实私钥的 FakeWallet，Live 模式再使用 MetaMask。RepuGate 只在 `ALLOW` 后提供范围受限的付款请求，永远不接收私钥。

3. **先验证证据，再计算分数**

   只有通过验证的评价才能进入有效声誉计算。

4. **核心逻辑与外部基础设施分离**

   声誉算法和门控策略只处理标准化输入。区块链 RPC、ERC-8004、x402 和存储访问均通过适配器完成。

5. **付款失败时采用安全默认行为**

   身份缺失、数据过期、RPC 故障或证据不足时，系统不能静默地允许无限制自动付款。

6. **限制项目范围**

   课程原型只支持明确且有限的 x402 和 EVM 功能，不追求生产级多链支持。

7. **实验必须可复现**

   所有安全性结论都必须来自可控攻击、基线对比、可重复实验和保存下来的原始结果。

8. **决策必须绑定具体付款**

   一次 `ALLOW` 只对被评估的那一个 x402 报价有效，不能被重复用于不同的收款人、资产、金额、endpoint、身份状态或策略版本。

9. **付款处理必须幂等**

   发生超时或结算结果不确定时，必须使用已有 payment identifier、nonce 和交易哈希完成核对，之后才能创建新的付款授权。

## 4. 项目范围

### 4.1 课程原型支持的范围

- EVM 兼容链
- x402 v2
- x402 `exact` 付款模式
- Base Sepolia 上的测试 USDC 付款；确定性模式使用 fixture 或 mock settlement
- 每个实验服务对应一个 ERC-8004 身份
- 每个服务对应一个经过验证的 `agentWallet`
- 每个实验服务注册一个 endpoint
- 声誉分数统一到 0–100 范围
- 每个付款凭证最多对应一条有效评价
- 使用固定随机种子、fixture 和隔离的 mock 状态运行可复现实验
- 使用 Base Sepolia 进行可选的真实链上演示
- 使用客户端侧 `trustedFetch()` 集成方式
- 对选中的准确报价计算哈希，并使用短期、一次性的 `EvaluationGrant`
- 跟踪 ERC-8004 Identity Epoch
- 使用 x402 payment identifier 和结算核对机制
- 使用浏览器前端展示平台完成交互式评估、付款和实验可视化

### 4.2 不在项目范围内的内容

- Solana 和其他非 EVM 链
- 跨链付款和跨链声誉聚合
- Batch settlement 和 escrow 付款模式
- 生产级 x402 Facilitator
- 生产级区块链 Indexer
- TEE、zkML 和质押验证
- 完整的去中心化治理
- 生产级 Sybil 检测系统
- 对 RepuGate 应用之外发起的付款实施全局控制
- 用户钱包或本地电脑被攻破
- 区块链共识攻击或密码学原语攻击
- 保证 AI 服务返回内容一定正确
- 生产级争议处理或 AI 服务语义质量证明

## 5. 系统架构

```text
┌────────────────────────────────────────────────────────────────────┐
│ 前端展示平台                                                       │
│ Buyer Agent / Agent Console / Service Explorer / Attack Lab       │
│                                                                    │
│ Agent Controller ──► trustedFetch ──► 报价标准化与验证             │
│                                      │                             │
│                              EvaluationGrant                       │
│                                      │                             │
│                              GuardedPaymentClient ──► MetaMask     │
└──────────────────────┬──────────────────────────┬──────────────────┘
                       │ /evaluate + grant        │ 直接 HTTP/x402
                       ▼                          ▼
┌────────────────────────────────────┐   ┌──────────────────────────┐
│ RepuGate Evaluation API            │   │ Demo x402 Provider       │
│ IdentityEpoch / 评价证据           │   │ honest/faulty/malicious  │
│ 凭证验证 / Core Policy             │   │ 可选签名报价与交付凭证   │
│ Grant 存储 / 结算核对              │   └────────────┬─────────────┘
└───────────────┬───────────┬────────┘                │
                ▼           ▼                         ▼
       ERC-8004/EVM RPC   SQLite              Facilitator / EVM
```

系统分为三个主要层次。

### 5.1 Core 核心层

Core 包含确定性的、与外部基础设施无关的逻辑：

- 声誉分数计算
- 置信度计算
- 可疑行为权重
- 冷启动处理
- 付款限额策略
- Identity Epoch 推导
- EvaluationGrant 验证
- 付款状态转换规则
- `ALLOW`、`REVIEW` 或 `BLOCK` 决策

Core 不直接调用 RPC，也不直接读取数据库。因此，同一套逻辑既可以处理真实链上数据，也可以处理实验生成的模拟数据。

### 5.2 Adapter 适配层

Adapter 将外部数据转换成 Core 可以处理的标准化输入：

- **ERC-8004 Adapter**：读取身份、`agentWallet`、endpoint 和评价事件
- **EVM Receipt Adapter**：读取交易状态、付款人、收款人、Token、金额、区块号和确认状态
- **x402 Adapter**：解析付款要求、Offer/Receipt 扩展、payment identifier、付款授权和结算结果
- **SQLite Adapter**：保存缓存、Identity Epoch、一次性 Grant、付款尝试、已使用凭证和决策审计日志

### 5.3 Application 应用层

项目保留四个应用入口：

- **前端展示平台**：包含 Buyer Agent、Agent Console、钱包连接、`trustedFetch()`、门控付款客户端和可视化页面
- **RepuGate Evaluation API**：解析身份、验证证据、执行策略、签发一次性 Grant，并核对不确定的结算
- **独立 Demo Provider**：作为单独 HTTP 进程运行，提供可以切换诚实或恶意行为的 x402 endpoint
- **Experiment Runner**：生成评价和攻击场景，运行基线并保存实验结果

前端展示平台是项目的必要组成部分，但它只服务于系统演示和实验结果展示，不扩展成生产级管理后台。

### 5.4 前端展示平台

前端采用单页 React/Vite 应用，包含三个主要视图：

1. **Service Explorer（服务浏览）**

   展示受控实验中的诚实和恶意服务，以及对应的 ERC-8004 身份、endpoint、钱包、原始声誉和验证后声誉。

2. **Trust Evaluation（信任评估）**

   对选定服务运行付款决策流程，展示被选中的准确报价、offer hash、Identity Epoch、原始分数、验证后分数、置信度、接受和拒绝的评价、风险原因，以及最终 `ALLOW`、`REVIEW` 或 `BLOCK` 决策。启用钱包模式后，浏览器钱包只能在存在匹配且未过期的 `ALLOW` Grant 时请求签名。

3. **Attack Lab（攻击实验室）**

   加载由命令行实验程序生成的可复现攻击结果，并使用图表和表格比较 B0、B1、B2、B3-Beta 和 B3-Dirichlet。Presentation 模式使用固定的实验数据，避免演示结果依赖测试网状态。网页不直接启动长时间实验任务。

Trust Evaluation 页面可以包含付款凭证和审计详情抽屉。独立管理后台、用户管理系统和生产级分析平台不在项目范围内。

## 6. 为什么采用客户端侧中间件

主要集成形式是 `trustedFetch()`，而不是传统 HTTP Forward Proxy。

```text
Buyer Agent 调用类型受限的可信付款能力
      ↓
服务返回 HTTP 402 + PaymentRequired
      ↓
trustedFetch 选择并标准化一个准确报价
      ↓
RepuGate 评估报价、IdentityEpoch 和声誉证据
      ↓
Evaluation API 返回决策和一次性 EvaluationGrant
      ↓
GuardedPaymentClient 复核 Grant、报价哈希、身份和策略
      ↓
只有在 ALLOW 后，WalletPort 才签署准确的付款授权
（确定性模式使用 FakeWallet；Live 模式使用 MetaMask）
      ↓
客户端重新提交 x402 请求，并通过 paymentId 跟踪结算
```

该设计不需要代理所有请求和响应内容，可以减少隐私暴露，让私钥留在钱包中，同时避免与研究问题无关的 HTTP 转发复杂度。

在浏览器演示中，`trustedFetch()` 调用轻量的本地 RepuGate Evaluation API。该 API 提供 Core 评估、一次性 Grant 和付款状态处理，但不代理目标 API 流量。冻结实验 JSON 由前端只读打包；浏览器通过开发反向代理访问独立 x402 Provider，并使用配置的 WalletPort。

报价选择必须由 RepuGate 控制，不能交给可能在评估后自行选择其他 `accepts[]` 项的黑盒自动付款封装。项目使用较底层的 x402 客户端流程或显式 selector hook，保证在请求签名前已经知道最终选择的付款要求。

### 6.1 能力边界

Buyer Agent 位于前端展示平台中。Pre 阶段使用确定性的脚本 Agent：它按照预设任务选择服务并调用受限付款能力，不依赖外部 LLM 的可用性或随机输出。以后可以增加 LLM 作为决策解释层，但 LLM 不能绕过策略或直接访问钱包。Agent Controller 只能获得类似下面的接口：

```ts
interface TrustedPaymentPort {
  pay(input: {
    url: string;
    method: string;
    maxAmount: string;
  }): Promise<TrustedFetchResult>;
}
```

系统不会把 `window.ethereum`、通用 wallet client、`sendTransaction` 或 `signTypedData` 交给 Agent。钱包访问被限制在 `GuardedPaymentClient` 使用的私有前端模块中。

这是应用级安全边界，不是全局钱包防火墙。RepuGate 可以保证展示平台内暴露给 Buyer Agent 的付款操作都经过门控，但不能阻止用户、其他网页、被攻破的同源 JavaScript 或应用外代码独立请求 MetaMask 签名。若要实现钱包级强制门控，需要签名代理、委托 session key 或智能账户策略模块，这些不在课程原型范围内。

Presentation 最小 API：

```text
GET  /api/services
POST /api/evaluations
GET  /api/evaluations/:decisionId
POST /api/grants/:grantId/consume
POST /api/payments/:paymentId/events
GET  /api/payments/:paymentId
POST /api/payments/:paymentId/reconcile
```

可选的只读 Live 检查功能增加 `GET /api/live/erc8004`；fixture Presentation
流程不会调用或依赖这个接口。

前端提供两种模式：

- **确定性 Demo 模式**：使用保存的 fixture/mock 数据，保证 Presentation 现场始终可运行。
- **目标 Live 付款模式**：可选连接 MetaMask，执行 Base Sepolia x402 流程。

当前实现的第一阶段 Live 能力有意限定为只读：它解析一个配置好的 ERC-8004 身份，并在
同一 block snapshot 下通过 `readAllFeedback()` 读取完整的合约内评价和撤销状态。
8004scan Adapter 只提供不可信的交易哈希作为事件定位信息；每笔 receipt 都由配置的 RPC
获取，按照指定 Reputation Registry 解码，并与合约状态交叉核对，以恢复只存在于事件中的
endpoint。定位信息缺失、重复、多余或不匹配都会把历史标记为不完整并抑制 B1 分数。前端
把它作为可选 Inspector 提供；确定性 fixture 模式仍是默认路径，且完全不依赖 RPC 或
Indexer 可用性。Registry 事件 receipt 验证不等于付款依据验证。在能够安全读取不可信
付款声明并用 x402 EVM receipt 独立验证之前，Live B2/B3 会 fail closed，不会用模拟证据
或静默切换 fixture 代替。

实验由独立命令行程序运行，并把不可变的 JSON/CSV 结果写入 `data/results/`。前端展示平台打包生成后的冻结 JSON 并只读展示；实验不会与 API 共用可变的 Grant、付款或防重放状态。

## 7. 请求与决策流程

### 7.1 初始请求

前端展示平台内的 Buyer Agent 调用 `trustedFetch()`。服务返回 `402 Payment Required` 和 `PaymentRequired` 对象。此时尚未创建任何付款授权。

### 7.2 选择并验证准确报价

`trustedFetch()` 只选择一个 `accepts[]` 项，并创建至少包含以下字段的标准表示：

```text
HTTP method
标准化 resource URL 和 endpoint hash
request body hash（没有 body 时使用固定空值）
scheme
network
asset
amount
payTo
maxTimeoutSeconds
相关 identity extension 字段
```

`packages/core` 提供唯一的 `canonicalizeOffer()` 实现，对 URL、CAIP-2 network、EVM 地址和数值格式进行确定性标准化，再按照固定字段顺序进行 ABI encoding，并计算 `offerHash = keccak256(encodedOffer)`。Web、API 和实验程序必须复用该实现，不能分别序列化 JSON。如果 Provider 提供官方 x402 Offer/Receipt 扩展，RepuGate 还会验证签名报价，并逐字段检查它是否与选中的 `accepts[]` 项一致。数组下标不能作为权威依据。签名密钥必须是 `payTo` 钱包，或能够证明获得了服务域名的授权。

签名报价可以提高真实性和审计能力，但 `EvaluationGrant.offerHash` 仍然是必需的，因为只比较部分字段的 receipt 或辅助函数不足以保证决策与实际付款完全一致。

### 7.3 服务身份解析与 Identity Epoch

RepuGate 使用以下信息解析服务身份：

- 目标 URL
- x402 `payTo` 地址
- 服务声明的 ERC-8004 `agentId`
- ERC-8004 注册 endpoint
- ERC-8004 注册 `agentWallet`

系统不能直接信任服务自己提供的 `agentId`，必须检查注册 endpoint 和钱包是否对应。

受控 Demo Provider 在 `PaymentRequired.extensions` 中使用项目自定义且明确标为实验性的 `repugate-agent` 扩展，传递 `agentRegistry`、`agentId` 和 `endpointHash`。这些字段只是解析线索，不是信任依据；`endpointHash` 使客户端可以在解析身份前绑定报价，但 Evaluation API 仍必须从注册 endpoint 重新推导并拒绝不匹配的值。RepuGate 必须通过链上或冻结 fixture 验证 registry、endpoint、owner、`agentWallet` 和 `payTo` 的关系，不能把该扩展描述成官方 x402/ERC-8004 标准。

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

RepuGate 推导当前 Identity Epoch：

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

owner 转移、`agentWallet` 替换、endpoint 替换或 registration file 发生重要变化时，系统创建新的 epoch。旧评价仍可用于审计展示，但不会自动成为新 owner 或新 endpoint 的运营声誉。

### 7.4 加载评价

ERC-8004 Adapter 加载与目标服务身份有关的评价。系统可能使用：

- 评价者或 `clientAddress`
- 声誉数值和小数位
- 标签
- endpoint
- `feedbackURI`
- `feedbackHash`
- 评价文件中的付款证明

当前只读 Live Adapter 只通过 `NewFeedback` 和 `FeedbackRevoked` 事件使用
Registry 自身记录的字段。它暂时不会访问任意 `feedbackURI`，因此 Live 模式
还没有可验证的付款证明，只报告 B1 原始声誉。B2 和 B3 必须依赖下一节所述的
独立付款证据验证器；在验证器接入前一律 fail closed。

MVP 只聚合明确支持的同一语义维度。默认使用 `tag1 = quality`，并规定数值范围为 0–100。延迟、uptime、收入和质量等不同含义的数据不能直接平均。

`feedbackURI` 是不可信网络输入。加载器设置严格的大小和超时限制，只允许配置过的 HTTPS 或 IPFS 来源；除明确的本地 Demo allowlist 外，拒绝重定向到私有地址或 loopback；同时验证 content type 和存在时的 `feedbackHash`。

### 7.5 验证付款证据

RepuGate 对每条评价尽可能检查以下条件：

```text
付款交易确实存在
付款交易执行成功
付款人等于评价者
收款人等于服务的 agentWallet
链、Token 和金额与付款声明匹配
评价 endpoint 与注册服务 endpoint 匹配
付款发生在评价提交之前
能够确定准确的 Token Transfer log 或授权 nonce
证据属于当前服务的 IdentityEpoch
付款凭证唯一键没有被其他已接受评价使用
```

验证器返回标准化结果：

```json
{
  "valid": false,
  "reason": "RECEIPT_REPLAYED"
}
```

可能的失败原因包括：

- `TRANSACTION_NOT_FOUND`
- `TRANSACTION_FAILED`
- `PAYER_MISMATCH`
- `RECIPIENT_MISMATCH`
- `SERVICE_MISMATCH`
- `TOKEN_OR_AMOUNT_MISMATCH`
- `INSUFFICIENT_CONFIRMATIONS`
- `RECEIPT_REPLAYED`
- `INVALID_FEEDBACK_DOCUMENT`

存在 Token Transfer log 时，确定性的证据唯一键为 `(chainId, transactionHash, logIndex)`；同时保存 EIP-3009 authorization nonce 作为额外保护。系统不能假设 txHash 永远只代表一笔付款，因为 multicall 或同一交易内可能包含多个 Transfer log。

证据去重在原子化 ingestion 操作中完成，而不是作为只读 `/evaluate` 的副作用。因此，重复执行评估不会消耗或破坏证据。

### 7.6 计算声誉

当前评分模块输出类似以下结果：

```json
{
  "rawScoreBps": 7800,
  "verifiedScoreBps": 7600,
  "confidenceBps": 6000,
  "distinctReviewerCount": 3,
  "riskFlags": []
}
```

未来的链上 Live Adapter 可以进一步加入数据源可用性状态：

```text
measured           已评估足够的有效证据
insufficient-data  存在有效证据，但置信度不足
not-indexed        服务尚未进入本地数据集
degraded           预期数据源失败或数据已过期
```

缺失或失败的测量不能被静默转换成看似中性的分数。Presentation 第一版需要实现验证后评价过滤、单一评价者权重上限、评价者多样性和简单置信度。资金聚类和复杂 Sybil 检测仍为可选功能。

### 7.7 门控决策与 EvaluationGrant

Policy Engine 综合声誉、置信度、风险信号和付款金额作出决策。

示例策略：

```text
高分且置信度充分                 ALLOW
新服务或证据不完整               REVIEW 或只允许小额试用
低分或存在强攻击信号             BLOCK
付款金额超过用户设置的上限       BLOCK
```

门控阈值只是实验参数，不代表通用的信任标准。

`ALLOW` 结果生成一个短期、一次性的 Grant：

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

Evaluation API 保存 Grant，并在门控付款路径使用时以原子操作标记为已消费。伪造的决策 JSON、过期 Grant、变化后的 Identity Epoch、不同 buyer、变化后的 policy 或 offer hash 不匹配都不能授权签名。

### 7.8 受门控的钱包授权

只有匹配的 `ALLOW` Grant 才能让 `GuardedPaymentClient` 请求钱包签名。在调用 MetaMask 前，它再次检查实际授权的接收地址和金额是否与所选报价及 Grant 一致。默认禁止跳转到其他 origin；如果允许跳转，必须针对最终 URL 和新的报价重新评估。

RepuGate 不接收或保存钱包私钥。如果用户拒绝 MetaMask，已经消费的 Grant 不会重复使用，必须重新评估。

### 7.9 付款状态与结算核对

每次付款尝试都有稳定的 `paymentId`，并遵循以下状态机：

```text
CREATED
  → AUTHORIZED
  → SUBMITTED
  → SETTLEMENT_PENDING
  → SETTLED | FAILED
```

Evaluation API 是 `payment_attempts` 的唯一持久化写入方。浏览器通过 `POST /api/payments/:paymentId/events` 报告授权、提交和收到的结算信息；API 校验状态转换，最终 `SETTLED` 必须由链上交易和 receipt/log 验证确认。浏览器显示的临时状态不能覆盖已经验证的最终状态。

当 x402 返回 `settlement_pending` 时，响应必须包含 transaction hash 和 network。客户端或核对服务在创建新授权前先检查这笔交易。结果仍不确定时，RepuGate 保持 pending 状态，不能仅因 HTTP/RPC 超时便签署新 nonce。如果 Provider 支持官方 payment-identifier 扩展，重试时继续使用同一 identifier，使 Provider 或 Facilitator 可以返回缓存结果。

### 7.10 交付凭证与审计记录

成功返回后，可以使用可选的签名 delivery receipt，把已结算付款与准确请求、响应的哈希绑定。它只能证明返回过哪些字节，不能证明 AI 答案正确、有用或诚实。负面评价不能强制依赖 Provider 签发的 receipt，否则恶意 Provider 可以拒绝提供凭证。

每次评估保存以下内容，用于解释和实验：

- 服务身份
- Identity Epoch
- 准确的 offer hash 和 policy hash
- EvaluationGrant ID 和 paymentId
- 请求付款金额
- 原始声誉分数
- 验证后声誉分数
- 置信度
- 接受和拒绝的评价数量
- 检测到的风险标记
- 最终决策
- 数据对应区块号和新鲜度
- 可用时保存付款状态、authorization nonce、transaction hash 和 Transfer log index
- 评估延迟

## 8. 声誉模型与实验基线

这些基线用于比较“声誉证据如何改变付款决策”，必须与 RepuGate 的公共付款安全机制
分开理解。B0 到 B3 都运行在同一条门控流程中，额外共享 canonical offer、身份绑定、
用户预算、钱包网络、一次性 Grant、重定向和付款状态检查。因此，如果 B0/B1/B2/B3
都阻止报价替换，这证明的是公共网关有效，而不是某个声誉模型更好。

### 当前评分范围

当前评分器有意只评估一个语义明确的声誉维度：`tag1 = quality`，并将其表示为规定的
0–100 分。确定性场景还要求 `tag2 = inference`，用于识别 AI inference 服务子类型；
`inference` 是范围过滤条件，不是第二个数值评分维度。

这是本项目的设计选择，而不是 ERC-8004 的限制。它使 B1/B2/B3 声誉模型构成受控
比较：这些模型估计同一种服务属性，实验变量只是评价如何被验证和聚合；B0 是不使用
声誉的参考基线。身份绑定、付款有效性、reviewer 多样性和 confidence 属于证据或风险
信号，因此与 quality 分数分开处理。

latency、uptime、success rate、price 和 revenue 的单位、方向和语义均不相同。直接将
它们与 quality 混合会得到任意的综合分数，使实验结论难以解释。未来的多维模型应分别
定义并标准化各维度，输出各维度结果；只有在声明权重的明确策略中才能进一步组合。
第 15.1 节说明了在当前 quality 维度内部扩展证据权重的兼容方案。

### B0：No Reputation Gate（已实现的参考基线）

**目的。** B0 用来衡量 Buyer 使用相同的受保护 x402 付款路径、但完全不执行基于声誉
的信任判断时会发生什么。

**输入与计算。** B0 仍解析服务身份，但只用于公共的 offer/payee/endpoint 绑定；它不
加载 feedback、不计算 score/confidence，也不调用付款证据验证器。score 和 confidence
明确返回 `null`，而不是用 0 冒充没有测量的数据。

**决策。** 公共的报价、身份、预算、网络和重定向检查全部通过后，B0 返回 `ALLOW`，
原因为 `REPUTATION_GATE_DISABLED`。API 随后签发与其他基线相同的准确报价绑定、短期、
一次性 EvaluationGrant。因此，没有声誉、声誉被操纵和诚实的 Provider 会得到相同待遇。

**能够与不能防御的攻击。** B0 继承公共网关对格式错误、预算、准确报价绑定、Grant
重放和付款状态的检查；但不能防御无付款刷分、作为声誉证据的 receipt replay、评价者
集中、付费 Sybil 自评、串谋、身份白洗，也不能判断服务是否可信。

**实现状态。** B0 已接入共享 Core evaluator、API、确定性 Buyer 流程、experiment
runner 和 Attack Lab。

### B1：Raw ERC-8004 Reputation

**目的。** B1 表示直接使用原始 ERC-8004 声誉的朴素方案，用来说明“链上存在评价”
并不能证明评价者真的购买过服务。

**输入过滤。** B1 只保留满足以下条件的评价：属于所选 Agent、未撤销、匹配配置的
`quality`/服务标签和注册 endpoint，并且分数位于支持的 0–100 范围。它不要求付款证明。

**评分方法。** 每条接受的评价权重相同：

```text
B1 score = 所有通过基础过滤的原始评价分数的算术平均值
```

系统仍计算不同 reviewer 数量和 confidence，但它们只作为诊断信息，不参与 B1 门控。

**攻击覆盖。** B1 可以排除已撤销、格式错误、错误 Agent、错误标签和错误 endpoint 的
评价；但无法阻止攻击者创建无付款高分、把一份付款凭证附到多条评价、从一个地址提交
大量评价，或者把评价分散到多个 Sybil 钱包。在当前固定 fixture 中，B1 会放行无付款
刷分、receipt replay 和评价者集中攻击。报价不匹配由公共 exact-offer gate 阻止，
并不是 B1 声誉算法的能力。

### B2：Payment-Grounded Reputation

**目的。** B2 要求每条影响声誉的评价都能对应一笔真实、唯一且与目标服务绑定的付款。

**证据检查。** B2 先执行与 B1 相同的评价范围过滤，然后只有同时满足以下条件才接受：

- 评价包含付款证明，且 verifier 返回有效 receipt
- 声明的 chain、transaction hash、log index、payer、recipient 和可选 authorization
  nonce 与验证结果一致
- receipt payer 等于 ERC-8004 评价中的 `clientAddress`
- recipient 等于该服务身份的 `agentWallet`
- 付款属于当前 Identity Epoch
- settlement block 不晚于评价被观察到的 block
- 验证后的付款金额大于零
- receipt key 和 authorization nonce 没有被其他评价占用，包括当前批次以及注入的
  receipt-use reader 返回的占用状态

**评分方法。** 每条通过付款验证的评价仍然具有相同权重：

```text
B2 score = 所有通过付款验证的评价记录分数的算术平均值
```

reviewer 多样性和 confidence 仍只用于诊断，不参与 B2 门控。

**攻击覆盖。** B2 可以防御无付款评价、无效或不匹配的付款证明、receipt/nonce replay、
付款人与评价者不一致、错误收款方、错误 Identity Epoch，以及服务身份或收款绑定不同
时的跨服务 receipt 重用。但 B2 无法阻止同一个 reviewer 完成多笔独立有效付款后提交
多条等权评价，也不能证明不同钱包彼此独立。因此，资金来自同一来源的 Sybil 钱包、
自付款和串谋仍然可能发生。在固定 fixture 中，B2 阻止无付款刷分和 receipt replay，
但会放行评价者集中攻击。

### B3-Beta：Bayesian RepuGate（已实现）

**目的。** `B3_REPUGATE` 在 B2 上增加单 reviewer 影响上限和 Bayesian 冷启动模型。与直接使用
算术平均不同，它为少量证据引入显式先验，不会假设任意样本量下的平均分都同样可靠。

**证据检查。** B3 接受的付款证据与 B2 完全相同。

**Reviewer 证据单元。** B3 按不区分大小写的 reviewer 地址分组。无论一个地址完成了
多少次有效付款和评价，每个 reviewer 只贡献一个归一化证据单元：

```text
x_r = reviewer r 的有效评价平均分 / 100
0 <= x_r <= 1
n   = 不同有效付款 reviewer 数量
```

**Bayesian 分数。** 模型使用均匀 `Beta(1,1)` 先验。连续 reviewer 分数贡献 `x_r`
份正证据和 `1 - x_r` 份负证据：

```text
alpha = 1 + sum(x_r)
beta  = 1 + sum(1 - x_r)
B3-Beta score = alpha / (alpha + beta)
```

代码实现保持确定性，并避免浮点计算。若 `reviewerScoreBps(r)` 是每个 reviewer
经过取整的 0–10,000 平均分，则：

```text
B3-Beta scoreBps = roundHalfUp((10,000 + sum(reviewerScoreBps(r))) / (n + 2))
confidenceBps = floor(n * 10,000 / (n + 2))
```

**公式推导与来源。** 令 `p` 表示未来一次交互获得满意结果的未知概率。Beta posterior
及其期望来自 Jøsang 和 Ismail 的
[*The Beta Reputation System*](https://sites.cc.gatech.edu/fac/Charles.Isbell/classes/reading/papers/josang/JI2002-Bled.pdf)：

```text
p ~ Beta(alpha, beta)
E[p | evidence] = alpha / (alpha + beta)

alpha = alpha_0 + sum(x_r)
beta  = beta_0  + sum(1 - x_r)
alpha_0 = beta_0 = 1

因此：
E[p | evidence] = (1 + sum(x_r)) / (n + 2)
```

该论文允许把正面与负面反馈表示为连续数量；把归一化评分作为分数形式的正/负证据，
也与 Jøsang、Luo 和 Chen 的
[*Continuous Ratings in Discrete Bayesian Reputation Systems*](https://dl.ifip.org/db/conf/ifiptm/ifiptm2008/JosangLC08.pdf)
一致。以下部分是明确的 **RepuGate 项目设计选择**，不能说成论文原封不动提出的公式：
选择 `Beta(1,1)` 先验；先把同一钱包的全部记录合并为一个 reviewer mean；只接受有
付款依据的证据；以及把 `confidence = n/(n+2)` 定义为 posterior 总质量中由实际
reviewer 证据贡献的比例。因此 confidence 是工程上的 evidence-strength 指标，不是
Bayesian credible level，也不是“决策正确的概率”。

这是对 Beta Reputation System 的连续评分适配。先验会把极少样本产生的极端分数向
50% 收缩。若 `n = 0`，RepuGate 报告无分数和零 confidence，而不会把先验均值冒充成
实际测量的声誉。

**证据置信度。** confidence 表示 posterior 中证据质量相对于先验加证据总质量的比例：

```text
confidence = n / (n + 2)
```

其中 `2` 来自 `Beta(1,1)` 的先验强度，而不是另行指定的“达到满置信度评价者数”。
这个值表示 evidence certainty，不表示“分数有这么大的概率正确”。B1 和 B2 也会把
该指标作为诊断信息，分别使用其范围过滤后和付款验证后的不同 reviewer 数量；只有 B3
将其作为 `ALLOW` 条件。
不同 reviewer 少于 3 个时会产生 `LOW_DISTINCT_REVIEWER_COUNT`；3 个 reviewer
也正好是默认 60% confidence 门槛要求的最低数量。

因此，同一个 reviewer 提交五条评价与只提交一条评价具有相同的总体影响。B3 要求
posterior score 与 evidence confidence 同时满足 `ALLOW` 门槛。已批准设计包含：

- 继承自 B2 的有效付款筛选
- 每个不同 reviewer 只贡献一个证据单元
- `Beta(1,1)` 先验和 posterior mean 声誉分数
- 用 posterior strength 处理冷启动 confidence

**攻击覆盖。** B3 继承 B2 的全部防护，并进一步降低单钱包评价者集中攻击的效果，
即使每条重复评价都具有不同的有效付款。在固定评价者集中 fixture 中，B2 计算
`(5×100 + 2×0) / 7 = 71.43%` 并放行；Bayesian B3 先得到 reviewer 证据
`[1, 0, 0]`，再计算 `Beta(2,3)`，posterior score 为 40%，evidence confidence
为 60%，因此分数低于策略门槛并阻止付款。诚实场景 `[80, 90, 100]` 得到
`Beta(3.7,1.3)`，score 为 74%、confidence 为 60%，仍能通过冻结门槛。

**局限。** B3 不是完整的 Sybil resistance。证据单元假设不同有效付款钱包具有一定
独立性，但攻击者可以资助多个钱包并进行真实付款来破坏该假设。把连续分数拆分为分数
形式的正负证据是一项明确的建模适配，并不表示每条评价都是字面意义上的 Bernoulli
试验。B3 也不能检测共同资金来源、多个 reviewer 串谋、短时间评价爆发、身份白洗或
真实付款后的恶意评价。先验选择、策略门槛和攻击比例需要 sensitivity analysis；
posterior credible interval 是计划加入报告的指标，尚未成为实现中的门控条件。

**权重设计理由。** 付款金额不能线性增加评价权重，因为 Provider 可以通过自付款
收回大部分资金，从而低成本购买声誉。不同有效付款人和单 reviewer 单位证据属于风险
控制，而不是独立用户的证明；交易时间分布和资金集中度仍属于未来扩展。

### B3-Dirichlet：有序多分类 Bayesian 变体（已实现）

**目的。** `B3_DIRICHLET` 保留完整的 B3 安全路径，但把评分建模为五档有序类别分布，
而不是压缩为一个 Beta 均值。五档及其锚点为：

```text
Very Poor = 0     Poor = 25     Neutral = 50
Good = 75         Excellent = 100
```

**连续分数的模糊证据。** 同一个 reviewer 级分数 `x_r` 按线性比例分配给相邻两档。
例如 80 分贡献 0.8 份 `Good` 和 0.2 份 `Excellent` 证据；90 分贡献 0.4 份
`Good` 和 0.6 份 `Excellent`。无论该地址有多少评价，每个 reviewer 的总证据质量
仍严格等于 1。

**先验与分数。** 模型使用总强度为 2 的五档对称 Dirichlet 先验，每档初始质量为
0.4。它与 `Beta(1,1)` 的总先验强度相同，便于公平比较。这里的分数不是普通平均分，
而是一个含义更具体的后验预测概率：

```text
alpha_k = 0.4 + 分配到类别 k 的 reviewer 模糊证据之和
B3-Dirichlet score = P(下一位独立 reviewer 给出 Good 或 Excellent | 当前证据)
                   = (alpha_Good + alpha_Excellent) / sum(alpha_k)
confidence         = n / (n + 2)
```

当 reviewer 分数 `x` 位于相邻锚点 `v_j` 与 `v_(j+1)` 之间时，实现采用以下三角形
membership：

```text
mu_j(x)     = (v_(j+1) - x) / (v_(j+1) - v_j)
mu_(j+1)(x) = (x - v_j)     / (v_(j+1) - v_j)
sum_k mu_k(x) = 1
```

多分类 Bayesian 基础来自 Jøsang 与 Haller 的
[*Dirichlet Reputation Systems*](https://doi.org/10.1109/ARES.2007.71)，它把二分类
Beta 模型推广到多个评分等级。使用 fuzzy membership 把连续分数分配到相邻离散等级，
来自 Jøsang、Luo 与 Chen 的
[*Continuous Ratings in Discrete Bayesian Reputation Systems*](https://dl.ifip.org/db/conf/ifiptm/ifiptm2008/JosangLC08.pdf)。
五个锚点、总强度 `C = 2` 的对称先验（`alpha_0,k = C/5 = 0.4`）、单 reviewer
影响上限，以及最终使用 `P(Good) + P(Excellent)` 作为门控分数，都是
**RepuGate 项目设计选择**。令 `m_(r,k) = mu_k(x_r)`，实现中的 posterior predictive
概率为：

```text
alpha_k = C/5 + sum_r m_(r,k)
P(L_k | evidence) = alpha_k / (C + n)
score = P(Good | evidence) + P(Excellent | evidence)
```

共用的 confidence 公式同样是本项目定义的证据占比 `n/(C+n)`，不是 Dirichlet 论文
提供的 credible interval。

确定性定点数实现为每个 reviewer 使用 10,000 个证据单位，每档先验使用 4,000
单位；当 `n = 0` 时报告无分数。诚实 `[80, 90, 100]` fixture 得到 76% score 和
60% confidence；评价者集中 `[100, 0, 0]` 得到 36% 和 60%，因此被阻止。冻结功能
实验中两种 B3 都使用 70% score 与 60% confidence 的 `ALLOW` 门槛。

**解释与局限。** B3-Beta 估计连续质量的期望值，B3-Dirichlet 估计下一次出现
`Good` 或更高评价的概率；两者回答不同问题，不能仅因某个百分比更大就判断模型更好。
两个变体都继承 B2 的付款证据检查、单 reviewer 影响上限和相同的 Sybil 独立性局限。

### 攻击覆盖汇总

`✓` 表示模型直接防御该攻击，`部分` 表示只能提高成本或覆盖受限形式，`✗` 表示模型
不能防御。公共网关机制单独标记，因为它们不是声誉算法的改进。

| 攻击或异常 | B0 | B1 | B2 | B3-Beta | B3-Dirichlet | 原因 |
| --- | --- | --- | --- | --- | --- | --- |
| 格式错误、已撤销、错误 Agent/tag/endpoint 评价 | 不适用 | ✓ | ✓ | ✓ | ✓ | B2/B3 继承 B1 的范围过滤 |
| 没有付款依据的高分评价 | ✗ | ✗ | ✓ | ✓ | ✓ | B2/B3 要求通过验证的付款证据 |
| 重复使用 receipt 或 authorization nonce | ✗ | ✗ | ✓ | ✓ | ✓ | B2/B3 强制 receipt 与 nonce 唯一 |
| 错误 payer、recipient 或 Identity Epoch | ✗ | ✗ | ✓ | ✓ | ✓ | B2/B3 把证据绑定到 reviewer 和服务身份 |
| 同一钱包通过多笔独立付款提交大量评价 | ✗ | ✗ | ✗ | ✓ | ✓ | 两种 B3 都让每个 reviewer 只占一个聚合票 |
| 极少 reviewer 制造高分 | ✗ | ✗ | ✗ | ✓ | ✓ | 两种 B3 都把 confidence 用作 ALLOW 门槛 |
| 多个真实付款且受同一资金方控制的 Sybil 钱包 | ✗ | ✗ | ✗ | 部分 | 部分 | 付款提高成本，但不能证明钱包独立 |
| reviewer 串谋或真实顾客恶意评价 | ✗ | ✗ | ✗ | ✗ | ✗ | 付款证据不能证明评价内容诚实 |
| 替换报价、收款方或 endpoint | 公共网关 | 公共网关 | 公共网关 | 公共网关 | 公共网关 | 来自 canonical offer/身份检查，而非评分 |
| 重放 EvaluationGrant 或篡改授权 | 公共网关 | 公共网关 | 公共网关 | 公共网关 | 公共网关 | 一次性 Grant 和逐字段 intent 复核 |

### 确定性固定实验结果

下表把已实现的攻击 fixtures 与全部基线和冻结门槛对应起来。破折号表示 B0 有意不产生
声誉分数。

| Fixture | B0 | B1 | B2 | B3-Beta | B3-Dirichlet | 主要原因 |
| --- | --- | --- | --- | --- | --- | --- |
| Honest（诚实场景） | ALLOW（—） | ALLOW | ALLOW | ALLOW（74%） | ALLOW（76%） | B0 忽略声誉；其他模型接收诚实证据 |
| Ungrounded ratings（无付款评价） | ALLOW（—） | ALLOW | BLOCK | BLOCK | BLOCK | B0/B1 不要求付款证明；B2/B3 过滤无付款评价 |
| Receipt replay（回执重放） | ALLOW（—） | ALLOW | BLOCK | BLOCK（36.7%） | BLOCK（26.7%） | B2/B3 对重复付款回执只接纳一条评价 |
| Reviewer concentration（评价者集中） | ALLOW（—） | ALLOW | ALLOW | BLOCK（40%） | BLOCK（36%） | B3 消除同钱包的数量优势后无法通过分数门槛 |
| Expected-offer mismatch（预期报价不匹配） | BLOCK（—） | BLOCK | BLOCK | BLOCK | BLOCK | 公共 canonical-offer 网关在付款前阻止，与声誉分数无关 |

### 已批准的 Bayesian 决策策略

Bayesian 实现把策略版本更新为 `repugate-policy-v2-bayesian`，避免 Grant 静默复用
v1 `policyHash` 的旧语义。已批准门槛为：

```text
ALLOW 分数门槛           70%（7,000 bps）
REVIEW 分数门槛          50%（5,000 bps）
B3 ALLOW 置信度门槛      60%（6,000 bps）
Bayesian 先验             Beta(1,1)；对称 Dirichlet(0.4 × 5)
confidence               n / (n + 2)，n 为对应阶段的不同 reviewer 数量
```

B0 不使用声誉门槛。B1 和 B2 只使用分数门槛，confidence 仅作为诊断信息；两种 B3
必须同时满足分数和 confidence 才能 `ALLOW`。分数达到 70% 但 B3 置信度不足时返回
`REVIEW`，分数低于 50% 时返回 `BLOCK`。对于五个已实现模型，任何身份或准确报价绑定失败都会
直接 `BLOCK`。这些策略参数和语义版本会被包含在 `policyHash` 中。

当前代码与生成的 Presentation artifact 已在 v2 policy hash 语义下实现两种
Bayesian B3。

## 9. 威胁模型

### 9.1 保护对象

- 付款 Agent 控制的资金
- 自动付款决策的正确性
- 声誉计算结果的完整性
- 付款凭证的唯一性和服务绑定
- 被评估报价与最终签名授权的准确绑定
- 不确定结算的幂等处理
- 最终决策的可解释性

### 9.2 攻击者

本项目考虑恶意 x402 服务提供方、恶意评价者以及双方串谋。

攻击者可以：

- 创建多个 EVM 钱包
- 注册多个 ERC-8004 身份
- 提交任意评价
- 未购买服务便提交评价
- 重复使用已有付款凭证
- 使用服务 A 的付款凭证评价服务 B
- 使用 Sybil 钱包进行小额自付款
- 控制多个评价钱包并协同行动
- 修改自己有权限修改的 metadata、endpoint 或钱包信息
- 放弃低声誉身份并注册新身份
- 观察公开链上数据
- 知道 RepuGate 的评分规则
- 在评估完成后修改金额、Token、收款地址、endpoint 或身份
- 返回跨 origin 重定向或前后不一致的 x402 报价
- 延迟响应或制造结算结果不确定的超时
- 提供恶意、超大或指向内网地址的 `feedbackURI`

Buyer Agent 可能因为模型错误或 prompt injection 产生错误付款意图，但它只能调用应用提供的类型受限可信付款能力。

### 9.3 信任假设

课程原型假设：

- Agent 钱包能够保护私钥
- 本地 RepuGate 程序没有被入侵
- 固定版本的 ERC-8004 合约按照源代码运行
- 已最终确认的区块链状态正确
- 所使用的 RPC 能返回正确链上数据
- Live 模式依赖所选 x402 facilitator 和链上 adapter 正确验证签名与结算；确定性模式只进行结构校验和模拟 settlement
- 标准密码学原语保持安全
- 不可信 JavaScript 不能在前端展示平台的可信 origin 中执行

ERC-8004 评价、评价文件、服务提供的 metadata、API 返回内容和未确认交易均被视为不可信。

### 9.4 不在范围内的攻击

- 钱包私钥泄露
- 用户电脑被攻破
- 区块链多数攻击或共识攻击
- 密码学签名和哈希伪造
- 可信 RPC 基础设施被直接攻破
- 与 RepuGate 无关的 x402 或 ERC-8004 底层合约漏洞
- 证明 AI 输出在语义上正确
- 全局阻止用户手动操作 MetaMask 或在 RepuGate 外发起付款

### 9.5 安全目标

- **G1 付款证据绑定**：没有真实付款依据的评价不得影响验证后声誉。
- **G2 凭证唯一性**：一份付款凭证最多只能影响一次声誉。
- **G3 服务绑定**：付款人、收款人、服务身份和 endpoint 必须保持一致。
- **G4 准确报价绑定**：一个报价的批准不能用于不同金额、资产、收款人、endpoint、Identity Epoch 或策略版本。
- **G5 幂等结算**：重试和不确定响应不能造成重复付款。
- **G6 抗操纵性**：随着操纵评价增加，B3 的性能退化应当慢于 B1。
- **G7 安全授权**：证据不足或存在可疑行为时，不得给予无限制自动付款权限。
- **G8 可用性**：系统不能通过阻止所有诚实服务来获得表面安全性。

## 10. 异常处理

| 异常情况 | 课程原型默认行为 |
| --- | --- |
| 找不到 ERC-8004 身份 | `REVIEW` 或只允许配置范围内的小额试用 |
| endpoint 或钱包不匹配 | `BLOCK` |
| 签名报价无效或与 `accepts[]` 不匹配 | `BLOCK` |
| 报价哈希、buyer、policy 或 Identity Epoch 与 Grant 不匹配 | `BLOCK` 并重新评估 |
| EvaluationGrant 已过期或被使用 | 重新评估，不得重复使用 |
| RPC 不可用 | 不自动授权超过低风险上限的付款 |
| 评价文件不可访问或格式错误 | 排除该评价 |
| Feedback URI 指向禁止访问的私有地址 | 不发起请求，排除评价并记录安全标记 |
| 交易确认数不足 | 等待或返回 `REVIEW` |
| 已广播交易但结算仍为 pending | 核对该交易，不创建新授权 |
| 付款凭证已经使用 | 排除评价并记录 Replay 风险 |
| 有效评价数量过少 | 降低置信度并使用冷启动策略 |
| 缓存数据过期 | 在自动付款前重新读取链上数据 |
| 请求金额超过用户限额 | `BLOCK` |
| 服务身份 metadata 发生变化 | 创建新的 Identity Epoch 并重新评估 |
| 已付款请求跳转到其他 origin | 默认阻止，或针对最终 origin 重新执行评估 |

## 11. 数据与存储

SQLite 足以支持课程原型。数据库只保存派生数据和本地状态，不保存私钥。

建议的逻辑表：

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

`receipt_uses` 对 `(chain_id, transaction_hash, log_index)` 建立唯一约束，并在可用时同时记录 authorization nonce。Grant 消费和证据 ingestion 使用数据库事务，防止并发请求重复消费同一个 Grant 或 receipt。

`payment_attempts` 保存稳定 payment identifier、offer hash、authorization nonce、transaction hash、network、当前状态和结算核对所需时间戳，绝不保存私钥或钱包 secret。

缓存的链上数据必须保存来源区块号，以便判断数据是否过期。

审计数据遵循最小化原则：保存标准化 origin/path hash 和所选付款字段，不保存 URL query、request body、authorization header 或钱包 secret。

## 12. 实验设计

### 12.1 研究问题

- **RQ1**：付款凭证验证能否拒绝没有真实服务付款的评价？
- **RQ2**：与原始 ERC-8004 声誉相比，RepuGate 能否减少向被操纵服务付款？
- **RQ3**：RepuGate 对诚实服务通过率、冷启动和人工确认负担有什么影响？
- **RQ4**：RepuGate 会引入多少延迟、RPC 和 Gas 开销？
- **RQ5**：报价绑定 Grant 和幂等结算核对能否阻止报价替换和失败重试中的重复付款？

当前确定性 Presentation fixtures 直接验证 RQ1、RQ2 和 RQ5 中的准确报价绑定部分。
RQ3、RQ4 以及重试行为的统计测量仍属于最终报告规模的实验工作。

### 12.2 攻击场景

当前 Presentation experiment runner 实现了四个固定对抗性 fixture：

1. 没有付款的虚假评价
2. 付款凭证重复使用
3. 评价者集中
4. Provider 报价金额与可信 catalog 中预期报价不一致

第四个 fixture 是在评估阶段发现的预期报价不匹配；它并不声称独立 Provider
在已经得到 `ALLOW` 后再次修改了报价。提交后网络状态不确定和一次性 Grant
行为已有确定性 Client/API 测试，但尚未汇总为实验结果行。

扩展版报告实验可以实现：

5. 跨服务使用付款凭证
6. Provider 在初始 `ALLOW` 后替换报价
7. 结算超时后的重复付款尝试
8. 真实自付款 Sybil 攻击
9. 多个评价者串谋
10. 短时间集中评价
11. 身份白洗
12. endpoint 或钱包替换

### 12.3 评价指标

当前 JSON/CSV 结果会为每个模型与场景组合记录：

- 决策以及是否授权付款
- 原始分数、验证后分数和 confidence
- 不同评价者数量
- 接受与拒绝的评价数量
- 声誉风险标记和准确报价风险标记

它还汇总每个模型的诚实场景放行率和对抗 fixture 放行率。当前
`75% / 75% / 25% / 0% / 0%` 只表示 B0/B1/B2/B3-Beta/B3-Dirichlet 分别
放行四个固定 fixture 中的 `3 / 3 / 1 / 0 / 0` 个，不是总体统计估计。B0 和 B1 在
这个小型数据集上相同，是因为三个声誉攻击都把原始分数抬高；扩展实验需要加入低声誉
和无声誉对照，才能测量 B1 相比 B0 的额外行为。

以下是报告规模的计划指标，当前 runner 尚不输出：带置信区间的诚实服务误拒绝率、
生成样本上的无效评价/重放接受率、重复付款率、分数膨胀曲线、攻击成本、人工确认率、
冷启动交互数、P50/P95/P99 延迟、RPC 调用次数和 Gas 成本。

Bayesian 报告实验必须预先声明 sensitivity sweep，至少比较 `Beta(0.5,0.5)`、
`Beta(1,1)`、`Beta(2,2)` 三种先验、不同强度的对称 Dirichlet 先验，以及
50%、60%、70% 三种 confidence 门槛。
最终配置应先在开发集上固定，再评估 held-out 场景，避免看到最终攻击结果后才选择先验
和策略参数。

### 12.4 公平比较方式

五种基线必须在相同或接近的诚实服务通过率下进行比较，否则系统可能仅仅因为阻止了
大量请求而显得安全。

核心比较问题是：

```text
在诚实服务通过率相同的情况下：
1. B1 使用原始声誉后，相比 B0 完全不门控会产生什么变化？
2. B2 相比 B1 能否减少无付款和凭证重放导致的付款？
3. 两种 B3 相比 B2 能否减少评价者集中情况下的付款？
4. Beta 的期望质量与 Dirichlet 的 Good-or-better 语义在诚实、冷启动和攻击分布下
   分别有什么表现？
```

当前 Presentation 对比是确定性功能基准：所有模型使用同一 fixture 和冻结策略，
保存配置 hash 与原始 JSON/CSV，并且五个模型都放行唯一的诚实对照 fixture。
由于它只有一个诚实 fixture、四个对抗 fixture、没有随机采样，而且每个组合只运行
一次，因此不能计算置信区间，也不能据此作总体统计结论。

如果最终报告需要提出统计结论，扩展实验应使用生成的开发集与评估集、固定随机种子、
多次重复、置信区间和参数敏感性分析；不同模型的诚实通过率应保持相同或相近，并保存
所有原始结果以便复现。

### 12.5 可控实验环境

下面是未来报告规模的可选实验环境，不是当前已经实现的数据集：

```text
10 个诚实服务
5 个恶意服务
100 个正常评价钱包
100 个 Sybil 钱包
5,000 次模拟交互
每个配置重复运行 20 次
```

当前 Presentation 数据集包含一个诚实对照和四个对抗 fixture，分别在 B0、B1、B2、
B3-Beta、B3-Dirichlet 下运行一次，共产生 25 行结果。

## 13. Presentation MVP

Presentation 原型优先实现一条可稳定演示的完整纵向流程：

- 一个集成在前端展示平台中的 Buyer Agent
- 一个可配置的 x402 Provider
- 一个冻结的 ERC-8004 风格服务身份，以及受控的诚实/对抗证据 profile
- 通过 Core ports 加载 fixture 身份与评价，后续链上 adapter 复用同一边界
- x402 `402 Payment Required` 处理
- 准确的 offer hash 和一次性 EvaluationGrant
- 确定性模式使用 FakeWallet 完成受门控 WalletPort 授权；MetaMask 仍属于 Live adapter
- payment identifier 和结算状态展示
- B1 原始声誉
- B2 付款依据过滤后的声誉
- 采用 reviewer 级聚合与 confidence gate 的 B3-Beta posterior mean 模型
- 在五档有序类别上计算 Good-or-better 后验预测概率的 B3-Dirichlet 模型
- `ALLOW` 和 `BLOCK` 决策
- 无付款刷分攻击
- 付款凭证重放攻击
- 评价者集中攻击
- 报价替换攻击
- 由冻结实验数据生成的四模型对比卡片和攻击矩阵
- 一次确定性模拟付款流程；准备完成时再增加 Base Sepolia Live 流程
- 一个浏览器前端展示页面
- Service Explorer、Trust Evaluation 和 Attack Lab 三个视图
- 不依赖实时测试网的确定性 Demo 数据

核心演示流程：

```text
恶意服务获得大量没有付款依据的高分评价。
B1 计算出高分并允许付款。
RepuGate 排除没有付款证据或重复使用的评价。
验证后分数下降，RepuGate 阻止付款。

诚实服务具有有效的付款凭证评价。
RepuGate 允许付款，x402 请求成功返回结果。
```

Presentation 必须清楚标记模拟场景和假设数据，不能把编造数字描述为实测结果。

## 14. 建议仓库结构

```text
RepuGate/
├── apps/
│   ├── web/                       # 展示 UI + 应用内 Buyer Agent
│   │   └── src/
│   │       ├── agent/             # Agent Controller；只能使用 TrustedPaymentPort
│   │       ├── pages/             # Explorer / Evaluation / Attack Lab
│   │       ├── wallet/            # 私有 MetaMask WalletPort Adapter
│   │       └── api/
│   ├── api/                       # RepuGate Evaluation API
│   │   └── src/
│   │       ├── routes/            # evaluate / grants / payments / results
│   │       ├── services/          # identity / evidence / grant / reconciliation
│   │       └── adapters/          # ERC-8004 / EVM / SQLite
│   └── provider/                  # 可配置的 Demo x402 收款方与服务方
├── packages/
│   ├── core/                      # 纯评分、Schema、规范化、Grant、Epoch、状态逻辑
│   ├── client/                    # trustedFetch + GuardedPaymentClient
│   └── x402/                      # 共享 wire headers、codec、Schema 与 payload 类型
├── experiments/                  # B0/B1/B2/B3、攻击场景和命令行运行程序
├── contracts/
│   └── MockEIP3009USDC.sol        # 可选，仅用于本地协议测试
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

这是逻辑上的最终结构，并不要求项目一开始就创建每个文件。开发应当从最小端到端流程开始，只增加直接支持研究问题或实验的模块。

依赖方向固定为 `web -> client -> {core, x402}`、`api -> core`、`experiments -> core` 和 `provider -> {core, x402}`。`core` 不依赖 React、HTTP、SQLite 或任何应用目录；Provider 在运行时保持独立。领域 DTO 与规则放在 `core`，x402 wire 常量、Schema 和 payload 类型放在职责窄化的 `packages/x402` 协议包，而不是通用 `shared` package。更具体的文件职责、接口和调用契约见 [`code-architecture.zh-CN.md`](./code-architecture.zh-CN.md)。

## 15. 未来工作与范围边界

### 15.1 未来声誉模型扩展

如第 8 节所定义，当前评分器只评估 `quality` 维度。以下 future work 一部分在这个受控
范围内扩展证据处理方式，另一部分说明未来如何在不削弱当前实验语义的前提下支持更多
评价维度。

以下前两个扩展改变的是**同一个 quality 维度内部**的证据权重；第三项则定义未来支持
更多评价维度的独立路径：

1. **Reviewer trust weighting。** 为 reviewer 分配透明权重 `w_r`，且权重依据必须独立
   于目标 Agent 当前分数，例如经过验证的交互历史、钱包年龄、资金聚类风险、可信信号
   提供者 allowlist，或者 EigenTrust/OpenRank 风格的信任图。B3-Beta 可以分别累加
   `w_r*x_r` 正证据与 `w_r*(1-x_r)` 负证据；B3-Dirichlet 可以向类别 `k` 累加
   `w_r*mu_k(x_r)`。权重必须设置上限并可审计，以减少中心化和循环信誉风险。实验需要
   reviewer graph 或带标签的 reviewer 数据集、可信 seed 敏感性测试，以及多个受同一
   资金方控制的钱包攻击。

2. **Time decay。** 使用 `w_time = 2^(-age/halfLife)` 等近期权重，使证据经过预先声明
   的 half-life 后影响力减半。它能响应 endpoint、模型或服务质量的变化，但也可能放大
   攻击者集中制造近期评价的 burst attack。half-life 应在开发集上确定并执行敏感性
   分析，不能观察最终攻击结果后再调整。

3. **显式标签与评价维度 Profile。** 当前 Live Inspector 会统计某个 Agent 实际出现的
   `tag1`/`tag2`，并解释严格范围过滤的排除原因，但不会改变其语义。未来版本可以进一步
   对 quality、uptime、latency 或 success rate 等受支持维度应用经过配置且可审计的
   Profile。每个 Profile 必须明确接受的标签、数值范围、单位、
   正负方向、归一化规则、endpoint 范围以及界面所显示分数的准确含义；同时保留原始事件
   字段，并记录归一化结果由哪个 Profile 产生。系统不得把 `mediationSuccess` 等任意标签
   自动解释成 `quality`，也不得在没有独立模型依据时将语义不同的维度平均成一个声誉分数。
   不支持的标签仍应作为原始观测展示，并给出明确的排除原因。当前 B0--B3 实验继续固定
   使用严格的 quality Profile，以保持各基线比较受控且可复现。

若同时使用前两项扩展，可以采用有上限的组合权重 `w_r = w_trust * w_time`。此时不能
原样沿用当前 `n/(n+2)` confidence；加权证据需要明确使用 `sum(w_r)` 等有效证据质量，
或有效样本量估计，并重新校准门槛。这些扩展尚未实现，也不属于当前安全性结论。

### 15.2 当前范围外的组件

初始设计明确排除以下内容：

- 独立区块链 Indexer
- 自定义 x402 Facilitator
- 自定义交互凭证智能合约
- Pre 阶段的本地真实 settlement；本地模式使用 fixture/mock，Live 模式使用 Base Sepolia
- 生产级 delivery receipt Merkle/EAS 上链锚定
- 传统 HTTP Forward Proxy
- 多个独立 Provider 应用
- 超出展示需求的生产级管理后台
- 多链抽象层
- 基于机器学习的 Sybil 检测
- escrow 和争议处理合约
- ERC-4337 或智能账户策略模块

这些组件会增加大量实现成本，但不是回答当前研究问题所必需的。

## 16. 预期交付物

- 可运行的源代码仓库
- 清晰的安装和运行说明
- 确定性本地 Demo
- 可交互的浏览器前端展示平台
- 可选的公共测试网演示
- Presentation 使用 B0/B1/B2/B3-Beta/B3-Dirichlet 基线
- 至少三个可复现的攻击场景
- 保存的实验配置和结果文件
- 可以重新生成表格或图表的脚本
- 单元测试、适配器测试和端到端测试
- 8 页 Presentation
- 最终课程报告
- 备用演示录像
- 明确记录的局限和信任假设

## 17. 当前已确定的决策

除非实现过程中出现新的证据，否则以下决策保持不变：

- 使用客户端侧 `trustedFetch()` 中间件
- Buyer Agent 集成在前端展示平台中，不作为独立应用
- Pre 阶段使用确定性脚本 Buyer Agent；LLM 只能作为以后可选的解释层
- Agent 只能获得 `TrustedPaymentPort`，不能调用通用钱包方法
- 签名保留在 WalletPort 中并位于 Evaluation API 之外；确定性模式使用 FakeWallet，Live 模式再使用 MetaMask
- 使用较底层的 x402 流程，由 RepuGate 控制报价选择
- 每笔自动付款都需要绑定准确报价、短期且一次性的 `EvaluationGrant`
- 声誉按照 `IdentityEpoch` 隔离
- 使用 payment identifier 和结算核对，禁止盲目重试
- Core 逻辑与外部 Adapter 分离
- 原型只支持 EVM
- 支持 x402 v2 `exact`
- 使用隔离的 fixture/mock 状态运行确定性实验
- 使用 Base Sepolia 进行可选 Live 演示，只处理测试币
- 使用 SQLite 保存缓存、防重放和决策日志
- Evaluation API 是支付状态的唯一持久化写入方
- 实验与现场演示使用不同数据库或结果目录
- 使用一个独立、可配置并采用模拟 settlement 的 Demo Provider 进程
- Honest 和 Malicious 服务使用不同的 ERC-8004 身份、endpoint 和收款配置
- 使用 React/Vite 构建同时支持确定性 Demo 和可选 Live 模式的前端展示平台
- 使用 TypeScript、Node.js、viem、SQLite、Vitest 和 pnpm workspace
- Pre 核心实验固定比较 B0、B1、B2、B3-Beta 和 B3-Dirichlet，并演示无付款刷分、凭证重放、评价者集中和报价替换
- 只声称 Payment-Grounded 和 Reviewer-Concentration-Aware
- 不声称完全抵御 Sybil 攻击
- 不声称付款或签名 delivery receipt 能证明 AI 输出的语义质量
- 安全门控只覆盖本应用，不能全局控制 MetaMask

## 18. 参考资料

- ERC-8004：<https://eips.ethereum.org/EIPS/eip-8004>
- x402 文档：<https://docs.x402.org/>
- x402 v2 规范：<https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md>
- x402 Offer/Receipt 扩展：<https://github.com/x402-foundation/x402/blob/main/specs/extensions/extension-offer-and-receipt.md>
- x402 Payment-Identifier 扩展：<https://github.com/x402-foundation/x402/blob/main/typescript/packages/extensions/src/payment-identifier/README.md>
- ERC-8004 声誉最佳实践：<https://github.com/erc-8004/best-practices/blob/main/Reputation.md>
- MainStreet 参考实现：<https://github.com/philpof102-svg/mainstreet>
- AEGIS escrow 参考实现：<https://github.com/im-sham/aegis-protocol>
- Aegis signer-proxy 参考实现：<https://github.com/Animesh-Parashar/Aegis-Protocol>
- x402-receipts 参考实现：<https://github.com/StelarDigital/x402-receipts>
- 已知 Offer/Receipt 绑定限制：<https://github.com/x402-foundation/x402/issues/3006>
- Jøsang 与 Ismail，*The Beta Reputation System*（2002）：<https://sites.cc.gatech.edu/fac/Charles.Isbell/classes/reading/papers/josang/JI2002-Bled.pdf>
- Jøsang、Luo 与 Chen，*Continuous Ratings in Discrete Bayesian Reputation Systems*（2008）：<https://dl.ifip.org/db/conf/ifiptm/ifiptm2008/JosangLC08.pdf>
- Jøsang 与 Haller，*Dirichlet Reputation Systems*（2007）：<https://doi.org/10.1109/ARES.2007.71>
