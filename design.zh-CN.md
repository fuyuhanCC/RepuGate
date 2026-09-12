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

   钱包签名始终在 MetaMask 或其他钱包服务内部完成。RepuGate 只在 `ALLOW` 后提供范围受限的付款请求，永远不接收私钥。

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
- **Demo Provider**：提供可以切换诚实、故障或恶意行为的 x402 endpoint
- **Experiment Runner**：生成评价和攻击场景，运行基线并保存实验结果

前端展示平台是项目的必要组成部分，但它只服务于系统演示和实验结果展示，不扩展成生产级管理后台。

### 5.4 前端展示平台

前端采用单页 React/Vite 应用，包含三个主要视图：

1. **Service Explorer（服务浏览）**

   展示受控实验中的诚实和恶意服务，以及对应的 ERC-8004 身份、endpoint、钱包、原始声誉和验证后声誉。

2. **Trust Evaluation（信任评估）**

   对选定服务运行付款决策流程，展示被选中的准确报价、offer hash、Identity Epoch、原始分数、验证后分数、置信度、接受和拒绝的评价、风险原因，以及最终 `ALLOW`、`REVIEW` 或 `BLOCK` 决策。启用钱包模式后，浏览器钱包只能在存在匹配且未过期的 `ALLOW` Grant 时请求签名。

3. **Attack Lab（攻击实验室）**

   加载由命令行实验程序生成的可复现攻击结果，并使用图表和表格重点比较 B1 和 B3。Presentation 模式使用固定的实验数据，避免演示结果依赖测试网状态。网页不直接启动长时间实验任务。

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
只有在 ALLOW 后，MetaMask 才签署准确的付款授权
      ↓
客户端重新提交 x402 请求，并通过 paymentId 跟踪结算
```

该设计不需要代理所有请求和响应内容，可以减少隐私暴露，让私钥留在钱包中，同时避免与研究问题无关的 HTTP 转发复杂度。

在浏览器演示中，`trustedFetch()` 调用一个轻量的本地 RepuGate Evaluation API。该 API 提供 Core 评估、一次性 Grant、结算核对和实验数据，但不代理目标 API 流量。浏览器直接与 x402 服务和钱包通信。

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
GET  /api/experiment-results/latest
```

前端提供两种模式：

- **确定性 Demo 模式**：使用保存的 fixture/mock 数据，保证 Presentation 现场始终可运行。
- **Live 模式**：可选连接 MetaMask，执行 Base Sepolia x402 流程。

实验由独立命令行程序运行并写入隔离结果目录或临时数据库。Presentation API 只读取冻结后的实验结果，不能与现场演示共用可变的 Grant、付款和防重放状态。

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

受控 Demo Provider 在 `PaymentRequired.extensions` 中使用项目自定义且明确标为实验性的 `repugate-agent` 扩展，传递 `agentRegistry` 和 `agentId`。这些字段只是解析线索，不是信任依据；RepuGate 必须通过链上或冻结 fixture 验证 registry、endpoint、owner、`agentWallet` 和 `payTo` 的关系，不能把该扩展描述成官方 x402/ERC-8004 标准。

```json
{
  "extensions": {
    "repugate-agent": {
      "info": {
        "agentRegistry": "0x...",
        "agentId": "12"
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

评分模块输出类似以下结果：

```json
{
  "score": 0.78,
  "confidence": 0.71,
  "verifiedFeedbackCount": 18,
  "rejectedFeedbackCount": 7,
  "sybilRisk": 0.22
}
```

评估结果同时包含依据状态：

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

### B0：No Gate

Agent 不评估服务声誉，直接授权所有格式有效的 x402 付款请求。

### B1：Raw ERC-8004 Reputation

直接聚合受支持 `quality` 维度中的所有未撤销评价，不要求评价包含真实交互或付款证明。

### B2：Payment-Grounded Reputation

只有具有有效、唯一且与目标服务绑定的付款凭证的评价才能影响分数。

### B3：Full RepuGate

B3 在 B2 基础上加入置信度和 Sybil 风险权重。候选因素包括：

- 有效交互数量
- 评价者多样性
- 单一评价者最大影响权重
- 时间衰减
- 短时间集中评价惩罚
- 共同资金来源惩罚
- 服务身份存在时间

项目不能声称完全抵御 Sybil 攻击。恶意服务可以创建多个钱包，再让这些钱包向自己进行真实付款。付款凭证可以提供更强的交互证据，防止零成本评价和凭证重用，但不能证明评价者彼此独立或评价内容诚实。

付款金额不能线性增加评价权重，因为 Provider 可以通过自付款收回大部分资金，从而低成本购买声誉。系统把不同有效付款人数量、单一评价者权重上限、交易时间分布和资金集中度作为风险信号，而不是独立用户的证明。

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
- x402 付款签名和结算能够被正确验证
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

### 12.2 攻击场景

Presentation 原型必须实现：

1. 没有付款的虚假评价
2. 付款凭证重复使用
3. 跨服务使用付款凭证
4. `ALLOW` 后替换报价
5. 结算超时后的重复付款尝试

后续实验可以实现：

6. 真实自付款 Sybil 攻击
7. 多个评价者串谋
8. 短时间集中评价
9. 身份白洗
10. endpoint 或钱包替换

### 12.3 评价指标

- 恶意服务付款率
- 诚实服务通过率
- 诚实服务误拒绝率
- 无效评价接受率
- 凭证重放接受率
- 报价替换授权率
- 重试和注入超时条件下的重复付款率
- 攻击条件下声誉上涨幅度
- 攻击成本
- 人工确认率
- 冷启动所需交互次数
- P50、P95 和 P99 评估延迟
- 每次评估使用的 RPC 请求数
- 评价和结算 Gas 成本

### 12.4 公平比较方式

B1 和 B3 必须在相同或接近的诚实服务通过率下进行比较，否则系统可能仅仅因为阻止了大量请求而显得安全。

核心比较问题是：

```text
在诚实服务通过率相同的情况下，
B3 的恶意服务付款率是否低于 B1？
```

实验应当使用固定随机种子、多次重复运行、保存配置并报告置信区间。最终 evaluation set 运行前冻结评分参数，并尽量分开开发场景和评估场景；同时报告失败场景和参数敏感性，避免只针对 B3 已知攻击进行调参。原始结果文件必须保留，以便重新生成图表。

### 12.5 可控实验环境

最终实验环境可以设置为：

```text
10 个诚实服务
5 个恶意服务
100 个正常评价钱包
100 个 Sybil 钱包
5,000 次模拟交互
每个配置重复运行 20 次
```

Presentation 阶段可以减少规模，最终报告再扩大实验。

## 13. Presentation MVP

Presentation 原型优先实现一条可稳定演示的完整纵向流程：

- 一个集成在前端展示平台中的 Buyer Agent
- 一个可配置的 x402 Provider
- 一个诚实服务身份
- 一个恶意服务身份
- ERC-8004 身份和评价加载
- x402 `402 Payment Required` 处理
- 准确的 offer hash 和一次性 EvaluationGrant
- 受门控的 MetaMask 授权
- payment identifier 和结算状态展示
- B1 原始声誉
- B3 完整 RepuGate 策略
- `ALLOW` 和 `BLOCK` 决策
- 无付款刷分攻击
- 付款凭证重放攻击
- 报价替换攻击
- 一张基线对比图
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
│   └── client/                    # trustedFetch + GuardedPaymentClient
├── experiments/                  # B1/B3、攻击场景和命令行运行程序
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

依赖方向固定为 `web -> client -> core`、`api -> core`、`experiments -> core` 和 `provider -> core`（仅公开 Schema/类型）。`core` 不依赖 React、HTTP、SQLite 或任何应用目录；Provider 在运行时保持独立。DTO、Schema、错误码和常量放入 `core`，不再保留与其职责重叠的 `shared` package。更具体的文件职责、接口和调用契约见 [`code-architecture.zh-CN.md`](./code-architecture.zh-CN.md)。

## 15. 推迟或移除的组件

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
- B0、B1 和支付凭证驱动型 RepuGate 基线
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
- 钱包签名保留在 MetaMask 中，并位于 Evaluation API 之外
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
- 使用单个可配置 Demo Provider
- Honest 和 Malicious 服务使用不同的 ERC-8004 身份、endpoint 和收款配置
- 使用 React/Vite 构建同时支持确定性 Demo 和可选 Live 模式的前端展示平台
- 使用 TypeScript、Node.js、viem、SQLite、Vitest 和 pnpm workspace
- Pre 核心实验固定比较 B1 和 B3，并演示无付款刷分、凭证重放和报价替换
- 只声称 Payment-Grounded 和 Sybil-Aware
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
