# 相关工作与竞品分析（2026-07 快照）

*[English](prior-art.en.md)*

本文是带日期的市场与研究快照，来源于 [`research/mmd-comparative-landscape-2026-07/`](../research/mmd-comparative-landscape-2026-07/) 的全面对比。stars、release 和公开功能会变化；机制分类与 MMD 的设计风险应随新证据复核。

## 定位结论

MMD 不应定位为“第一个多模型系统”，也不应声称“没有任何单模型权力”或“LiteLLM 生态没有竞品”。更准确的定位是：

> MMD 是 audit-first、claim-level 的多模型审议工作台。它保存 claim lineage、修订和异议，并用确定性规则计算支持标签，而不是让单个 judge 模型直接宣布共识。

MMD 的差异化是命题级审计数据模型、确定性支持标签和真实运行下的 failure/cost/trace 纪律，不是“民主”隐喻。

## 三层比较框架

### 1. 直接竞品

- **Amiable Dev LLM Council**：独立回答、匿名互评、Borda 排名、Chairman、dissent、成本、失败降级和 adaptive compute。它偏回答级排名，工程入口和 bias control 强于 MMD；MMD 的 claim lineage、revision 和 objection severity 更细。
- **MALLM**：可组合 persona、response、topology 和 decision protocol，并带 dataset/eval。它是研究平台基准，协议可消融性明显强于当前 MMD。
- **RECONCILE**：异构模型多轮互看、修订和置信度加权投票。适合闭集推理；没有 MMD 的通用 claim lineage。
- **Karpathy LLM Council**：独立回答、匿名排名、Chairman，机制简短且用户认知度高，但项目明确不长期维护。
- **Council Engine**：proposal、受限批评和 lead resolution，能输出 recommendation、alternatives、question 或 investigate，比“强制一个答案”更善于表达信息不足。
- **Star Chamber**：代码审查场景的结构化来源、聚类和 deterministic consensus/majority/individual 分桶，证明确定性分桶和来源追踪并非 MMD 独占。
- **OpenRouter Fusion**：panel、structured judge analysis、outer-model answer，并原生结合搜索。低摩擦产品能力强，但公开接口没有 MMD 的逐 candidate lineage。
- **litesquad**：workers、单一 critic、revision、clusterer 和 judge。可运行但角色绑定、缺少 claim-level provenance。
- **rachittshah/llmcouncil**：支持 vote/debate/synthesize/critique/red-team/MAV 等协议，适合作为多协议工具对照。

### 2. 机制 baseline

- **LLM-Blender**：PairRanker + GenFuser。
- **Mixture-of-Agents (MoA)**：分层并行生成与 aggregator。
- **经典 Multi-Agent Debate / Multi-LLM Debate**：检验互动与从众/错误传播。
- **ChatEval / Language Model Council**：多模型评委与回答生成系统的边界。
- **same-model sampling、majority/approval vote、简单 judge synthesis**：控制“更多调用或更多 tokens”本身的收益。

这些不是产品替代品，但直接挑战 MMD 的因果主张：若同模型、同 token/美元预算下的简单 sampling + ranking/fusion 已达到相同质量，六阶段互动不能仅凭最终分数证明必要。

### 3. 邻近生态

AutoGen、CAMEL、CrewAI、MetaGPT 和 AgentVerse 是通用 multi-agent runtime/框架。它们能做 tools、memory、handoff、workflow 和外部副作用；MMD 更像可以嵌入这些系统的审议 team pattern，而不是替代它们。

LiteLLM core 主要提供 gateway、routing、fallback、cost 和 reliability。它不原生定义完整审议协议，但完全可以承载 Council/MAD 应用，因此“MMD 所在生态位为空白”是不成立的。

## 机制对照

| 系统 | 核心机制 | 决策/输出权威 | Claim lineage | 分歧保留 | 主要优势 |
|---|---|---|---:|---:|---|
| MMD Standard-C | 互评→修订→归一→逐 claim 投票 | host classification ledger；coordinator prose | ● | ● | 审计、失败保留、产品化 trace |
| MMD Standard-D | peer Align→host 聚类→投票 | host ledger；当前仍有 coordinator prose | ● | ● | 研究候选治理权的集中/分布差异 |
| Amiable Council | 匿名回答级排名→Chairman | Borda + Chairman | — | ◐ | bias control、CI/API、adaptive compute |
| MALLM | 可组合拓扑和 decision protocol | 依配置 | — | ◐ | 学术实验自由度 |
| RECONCILE | 多轮修订→置信度加权票 | weighted vote | — | — | 异构闭集推理 |
| Fusion | panel→judge analysis→outer answer | judge + outer model | — | ● | 托管、搜索、低摩擦 |
| Star Chamber | finding 聚类→确定性分桶 | deterministic buckets | ◐ | ● | 领域 schema 可直接行动 |
| LLM-Blender/MoA | ranking/fusion 或分层 aggregation | ranker/fuser/aggregator | — | — | 强质量/compute baseline |

## MMD 仍有区分度的能力

- candidate 的 `source_claim_ids` 是 schema 约束，不只是 transcript。
- ballots、objection severity 和 classification inputs 可审计。
- critical/major 异议进入确定性规则，而不是由 composer 自由解释。
- trace 与产品 UI 共用同一数据模型；运行中失败仍保存已完成 artifacts。
- Planning 保留 topic ledgers，并用一次 GlobalCompose 形成跨主题答案与 span lineage。

## 必须保留的短板与反方判断

- **Normalize 是信息瓶颈**：集中 coordinator 可能 false merge、false split 或漏掉少数正确 claim；lineage 只能审计已经保留的内容。
- **Compose 仍可能软性改判**：标签虽确定，prose 可能淡化 disputed/rejected。Standard-D 当前也仍有 coordinator presentation call，fidelity checker 尚未完成。
- **Standard-D 不是已验证优越方案**：peer alignment 可能提高 false split、成本和 abstention。没有 MMD 自身双架构实测时，不应宣称分布式普遍更好。
- **缺少系统匿名化和自投偏差控制**：模型/provider identity 可能影响 critique/vote。
- **协议可插拔性有限**：研究自由度弱于 MALLM。
- **无自适应深度和共识校准证据**：support label 不能宣传成事实可信度。
- **公开 benchmark 和 compute-matched 证据不足**：真实质量、成本、延迟和方差尚未形成统一公开结果。
- **许可证不明确**：仓库根目录当前没有明确 `LICENSE`；代码可见不等于获得使用、修改和再分发授权。

新增 Standard-D 不会抹除这些集中式 coordinator 风险。历史研究文档中的瓶颈判断应保留，因为它们正是引入治理对照的研究动机。

## 建议的比较纪律

1. 同模型、同题、同预算比较 single、same-model multi-sample、majority、ranking/fusion、anonymous council、MMD Quick/Standard。
2. 分开报告 semantic quality、presentation quality、lineage coverage、false merge/split、dissent survival、cost、latency 和 partial failure。
3. 不把调用数当作 token 成本；Align 会重复发送 claims，GlobalCompose 有大上下文。
4. 不把 consensus label 当作 correctness；用闭集真值和人评做校准。
5. 对 Standard-C/D 只报告预注册的条件性 pipeline contrasts，不声称 Normalize/Compose 是天然可加的纯机制常数。

外部链接、访问日期和无法验证项见研究目录的 [`sources.md`](../research/mmd-comparative-landscape-2026-07/sources.md)。
