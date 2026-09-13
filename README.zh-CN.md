# RepuGate

[English](./README.md) | [简体中文](./README.zh-CN.md)

RepuGate 是面向 AI Agent 的 x402 声誉门控付款客户端。它评估 ERC-8004 风格的
服务声誉，将 `ALLOW` 决策绑定到一个准确报价，并且只有在一次性 Grant 被成功消费后，
才向 Agent 暴露受限的钱包付款能力。

## 文档

| 文档 | English | 简体中文 |
| --- | --- | --- |
| 系统设计、声誉模型、实验与威胁模型 | [design.md](./design.md) | [design.zh-CN.md](./design.zh-CN.md) |
| 代码模块、依赖边界与调用关系 | [code-architecture.md](./code-architecture.md) | [code-architecture.zh-CN.md](./code-architecture.zh-CN.md) |

## 当前声誉范围

当前实验有意只计算一个语义维度：规定为 0–100 的 `tag1 = quality`。确定性场景还使用
`tag2 = inference` 选择 AI inference 服务子类型；`inference` 是过滤条件，不是第二个
分数。

单一维度使 B1/B2/B3 声誉模型的对比保持可解释：所有模型接收语义相同的评价，实验
改变的是证据验证和聚合方法，而不是被测指标；B0 则是不使用声誉的参考基线。身份绑定、
付款有效性、reviewer 多样性和 confidence
属于信任或风险信号，并非额外质量维度。latency、uptime、success rate、price 和
revenue 具有不同单位，未来应分别标准化和评估，不能直接与 quality 求平均。Reviewer
trust weighting 和 time decay 已在设计文档中列为 quality 维度内部的 future work。

## 运行确定性 Presentation Demo

```bash
./pnpmw install
./pnpmw dev
```

打开 <http://127.0.0.1:5173>。Evaluation API 监听 `127.0.0.1:3001`，独立的 x402
Demo Provider 监听 `127.0.0.1:3002`，Vite 会代理这两个服务。该模式使用 FakeWallet
和模拟 settlement，不会打开 MetaMask、广播交易或花费真实资金。

Fixture 模式始终可用，并且是 Presentation 的默认路径。它不依赖 RPC endpoint、实时
Registry 或外部 metadata。

`pnpmw` 是项目本地启动器。在本机上，它会自动使用 Codex 自带的 Node.js 和 pnpm，
不要求全局安装或修改 shell `PATH`。如果系统已经全局安装 pnpm，启动器会优先使用该
版本。

推荐 Presentation 检查流程：

1. 使用 `B0 · No rep.` 运行 `Honest service`：系统不产生声誉分数，但仍通过公共的准确
   报价绑定和一次性 Grant 路径授权付款。
2. 使用 `B3 · Beta` 或 `B3 · Dirichlet` 运行 `Honest service`：决策为 `ALLOW`，
   Wallet 只签名一次；独立 Provider 收到一次初始 402 请求和一次带付款的重试；付款
   最后进入等待核对的 `SETTLEMENT_PENDING`。
3. 分别使用 B1 和 B2 运行 `Ungrounded ratings`：B1 允许付款，B2 拒绝没有有效付款
   证据的评价，而且不会调用 Wallet。
4. 分别使用 B2 和任一 B3 运行 `Reviewer concentration`：B2 因所有 receipt 有效而
   允许付款；两种 B3 都限制同一 reviewer 的重复影响并返回 `BLOCK`。
5. 使用 B2 或 B3 运行 `Receipt replay`：一份重复 receipt 不能产生五条可信评价。
6. 使用 B0 或任一声誉模型运行 `Offer substitution`：公共的 offer hash 检查会在消费
   Grant 和签名前停止付款流程。

## 可选的只读 ERC-8004 模式

Web 应用还包含一个 **Optional Live Registry** Inspector。它从正式 ERC-8004 Identity
和 Reputation Registry 读取一个 Agent，不请求钱包签名，也不发送交易。

```bash
cp .env.example .env
```

设置 `REPUGATE_LIVE_ERC8004=true`，并替换 `ERC8004_AGENT_ID`、
`ERC8004_SERVICE_ENDPOINT` 以及与示例不同的网络设置。然后运行 `./pnpmw dev`，在
页面底部选择 **Inspect live registry**。API endpoint 为 `GET /api/live/erc8004`。

Live Reader 在同一个区块高度读取身份和反馈快照，验证 Reputation Registry 是否属于
配置的 Identity Registry，读取 `ownerOf`、`agentWallet` 和 `tokenURI`，检查注册文件
的自引用与 endpoint，并根据 Registry 事件重建评价和撤销记录。注册文件下载是只读的，
仅允许受约束的 HTTPS/IPFS，不跟随重定向，并设置超时和 256 KiB 大小上限。

第一阶段 Live 功能只计算 **B1 raw reputation**。它不会获取任意 `feedbackURI`，也不会
把其中的付款声明当作已经验证的证据。在接入 EVM receipt verifier 前，B2/B3 继续使用
确定性证据路径。Live 查询失败不会静默回退到 fixture；UI 会显示错误，同时保留可用的
Presentation Demo。

## 重新生成冻结实验结果

```bash
./pnpmw experiment
```

该命令让 B0、B1、B2、B3-Beta 和 B3-Dirichlet 通过生产使用的 `evaluateOffer()` 路径运行
相同的五个确定性场景。它把 JSON 与 CSV 结果写入 `data/results/`，并更新 Web Attack
Lab 打包的生成结果。执行过程不需要 Web Server、Wallet、测试网或数据库。

## 验证

```bash
./pnpmw typecheck
./pnpmw test
./pnpmw build
```

完整的中英文系统设计和代码架构参见上方[文档表格](#文档)。
