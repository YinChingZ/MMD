# Research Plan：MMD 集中式与分布式协调架构融合

## Scope

研究 MMD 现有 coordinator-based Normalize/Compose 与拟议的 peer alignment、确定性 claim ledger/renderer 如何共存。重点是 Quick、Standard、Planning 的默认架构和 Paper A 的实验操作化；不在本轮实现代码或承诺未经实验验证的质量提升。

## Derived Analysis Dimensions

| Dimension | Why it matters | Seed sources/frameworks |
|---|---|---|
| 认知权力拓扑 | host orchestrator 与 LLM coordinator 不应混为一谈；融合必须明确议程设置权和编辑权 | MMD protocol/code；Magentic-One；LLM-Blender；Free-MAD |
| 模式—任务匹配 | 窄问答、审议和长文规划的输出对象不同 | MMD Quick/Standard/Planning；EoT |
| 因果可识别性 | 双架构若改变多个阶段，会破坏 C5−C4、C6−C5 的解释 | Paper A v0.4；共享 artifact 设计 |
| 信息保真 | 集中式偏遗漏/重写，分布式偏错误合并/拆分和从众 | MMD comparative report；Free-MAD；topology propagation research |
| 最终答案构造 | ledger 不是天然的最终答案，尤其对开放任务和长文 | MMD Compose/Planning；LLM-Blender GenFuser；MoA |
| 成本与延迟 | align 扇出与 compose 串行调用的成本形态不同 | MMD budget/orchestrator；MoA；MacNet |
| 可靠性与扩展性 | 单点失败与 quorum 降级具有不同风险 | MMD quorum；centralized/decentralized/hybrid comparisons |
| 可追溯与复现 | Paper A 需要协议版本和 branch lineage，不只是最终分数 | Paper A manifest/trace/parity requirements |
| 产品与研究接口 | 过多用户模式会增加理解成本，但实验需要更多条件 | MMD mode API；Paper A condition matrix |

## Evidence Plan

| Dimension | Questions to answer | Source types | Search paths |
|---|---|---|---|
| 权力拓扑 | coordinator 是否仍是常见、有效的聚合模式；去中心化解决什么 | 论文、官方研究报告、本地代码 | LLM-Blender、MoA、Magentic-One、Free-MAD |
| 模式匹配 | 三个模式各自的当前调用路径与语义 | 本地文档、源码、测试 | protocol、budget、orchestrator、prompts、schemas |
| 因果识别 | 哪些 artifacts 可以共享，哪些必须重新生成 | 研究方案、统计设计 | Paper A C0–C6、RQ1–RQ5 |
| 信息保真 | normalize/compose 和 peer alignment 各自可观测的失败 | 本地研究报告、论文 | candidate recall、dissent survival、trajectory scoring |
| 最终构造 | 是否需要 composer；Planning 是否需要强制收敛 | 论文、架构代码 | generative fusion、outline/section composition |
| 成本/可靠性 | 各方案调用数、串行深度与 quorum | 代码推导、pilot 待测项 | budgets、fanout、failure handling |
| trace/产品 | schema 和用户接口如何避免组合爆炸 | 本地实现、研究计划 | manifest、trace、API mode surface |

## Facts To Cross-Check

- Quick 的模型数和阶段是否在运行时被严格执行。
- Standard 中 normalize/compose 是否都是单一 coordinator 调用。
- Planning 的 outline、per-topic protocol 与最终整合到底有几层 coordinator 权力。
- Quick 的隐式 ballots 是否把 source coverage 当成 approve，从而依赖 normalize 质量。
- C4/C5/C6 当前共享 artifact 的研究要求是否允许双架构 paired branching。
- 分布式 alignment 的每阶段调用数和对最终答案选择的缺口。

## Anticipated Data Gaps And Bias Risks

- 尚无 MMD 自身集中式与分布式实现的实测质量、成本和延迟数据；所有优劣只能作为待检验假设。
- 外部多智能体论文的任务、模型和预算不同，不能直接推断 MMD 上的效应大小。
- “coordinator 主流”不等于“所有模式都应使用 coordinator”；流行度不能替代任务—架构匹配。
- peer alignment 仍由 LLM 作语义判断，不是完全去中心化或完全确定性。
- 如果先看 pilot 质量再选择主架构，会引入研究者自由度；阈值和选择规则必须用独立 split 冻结。
