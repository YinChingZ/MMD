# Research Plan: MMD 成本—性能与模型组合研究

## Scope
以 MMD 当前代码、协议文档和两个分支为工程边界；以多模型审议、ensemble/test-time compute、LLM-as-a-judge、routing/cascade、OpenRouter Fusion 为文献与竞品边界。目标不是泛泛综述，而是确定首篇研究的可识别因果问题和后续研究序列。

## Derived Analysis Dimensions
| Dimension | Why it matters | Seed sources/frameworks |
|---|---|---|
| 协议与研究就绪度 | 决定哪些变量已可控、哪些日志还缺失 | MMD protocol/prior-art/roadmap、两个分支代码 |
| 增益分解 | 防止把多采样或更高 token 预算误当成模型多样性 | self-consistency、majority vote、multi-agent debate |
| 有效多样性 | 模型名称不同不等于错误独立 | diversity/error correlation、heterogeneous MAD |
| 角色与拓扑 | 角色能力错配可能抵消 panel 增益 | debate、Mixture-of-Agents、judge/synthesizer 文献 |
| 多目标效率 | 产品与论文都不能只报告 accuracy | cost-quality-latency Pareto、selective inference |
| 任务异质性 | 平均分可能掩盖只在少数任务上有效 | reasoning、coding、deep research、factuality、多语言 |
| 评测有效性 | judge 偏差和污染可反转结论 | DRACO、LLM-as-a-judge、human validation |
| 自适应编排 | 最可能产生产品与学术差异化 | iMAD、routing、cascade、early exit |
| Fusion 对照 | 直接竞品定义了当前市场基线与可质疑结论 | OpenRouter Fusion docs/blog |
| 开放生态 | LiteLLM 上游路径影响研究复现和采用 | litellm-integration 分支、贡献规范 |

## Evidence Plan
| Dimension | Questions to answer | Source types | Search paths |
|---|---|---|---|
| MMD | 协议阶段、终止规则、成本与事件日志、配置面 | 本地源码/测试/文档 | README、docs、orchestrator、protocol、benchmarks |
| 分支 | LiteLLM 分支改了什么、适配边界与缺口 | git diff/log | main...litellm-integration |
| 文献 | 哪些增益已被证实、哪些结论冲突 | 论文原文/会议页/作者仓库 | arXiv、ACL/AAAI/OpenReview |
| Fusion | 机制、默认 panel、评测、成本、已披露限制 | 官方文档/官方博客/基准论文 | openrouter.ai、DRACO 原文 |
| 实验设计 | 必需 baselines、重复次数、指标、统计检验 | benchmark papers/评测指南 | primary papers and repos |
| 产品化 | 动态触发、Pareto 策略、失败恢复 | 论文 + 本地实现 | iMAD/cascades/routing + code |

## Facts To Cross-Check
- MMD 的实际阶段、默认共识阈值、预算/法定人数逻辑与已记录指标。
- litellm-integration 是否仅替换 provider 层，还是改变协议/API。
- Fusion 的 panel/judge/outer-model 调用拓扑、默认模型数、成本倍数和延迟声明。
- OpenRouter 的 DRACO 结果是否控制了工具、judge、样本缺失和污染。
- “异构模型优于同模型多采样”“debate 优于 vote”的证据是否稳健。
- 相关论文的任务范围、模型时代与是否报告真实美元成本/延迟。

## Anticipated Data Gaps And Bias Risks
- 商业模型版本和价格会变，报告必须保存模型快照、日期和实际账单。
- OpenRouter 的研究既是官方一手资料也是产品营销，需与论文和复现实验分开看。
- 闭源模型不可完全复现；同名模型可能静默更新。
- LLM judge 有自偏好、位置偏差、长度偏差；开放任务需要人评子样本。
- 多数 MAD 文献使用数学/QA 小任务，不能直接外推到深度研究或真实决策。
- 当前未验证 OpenRouter Fusion 的完整内部 prompt 与默认动态路由实现；缺失处不作推断性断言。
