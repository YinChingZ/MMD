# Research Brief: MMD 多模型审议框架研究规划

## Objective
- Topic: 评估 MMD 中模型组合、审议协议与聚合方式对质量、成本、延迟及可靠性的影响，并形成可发表、可复现实验路线。
- Decision context: 六人团队需要选择首批研究问题、实验基础设施、与 OpenRouter Fusion 的差异化方向，以及 LiteLLM 上游贡献路径。
- Intended reader: MMD 项目团队与潜在学术合作者。
- Expected expertise level: 熟悉 LLM API、基准测试和基本统计实验设计。
- Deliverable format: 中文深度研究报告 + 可执行研究路线图 + 来源与审查记录。
- Source/data cutoff: 2026-07-14；公开资料访问日同日；本地代码以当前 main 与本地 litellm-integration 分支为准。

## Hard Requirements
- 关键判断必须有可追溯、带日期的来源，或明确标为推断。
- 包含共识评估、证据限制、至少一个反直觉洞见和多个条件化结论。
- 缺失或不可验证的数据必须明确标注。
- 区分系统效应、额外计算效应与异构模型多样性效应。

## Analysis Dimensions
1. MMD 协议、数据结构、可观测性与两个分支的研究就绪度。
2. 多模型审议相对单模型、同模型多采样、投票和简单聚合的真实增益。
3. 模型能力、模型家族、训练来源与错误相关性所代表的“有效多样性”。
4. proposer/critic/reviser/judge/composer 等角色分配与位置效应。
5. 成本、token、延迟、失败率与质量的多目标 Pareto 前沿。
6. 任务类型、难度、可验证性、工具使用与多语言条件下的异质性。
7. 评测有效性：基准污染、LLM judge 偏差、统计功效、重复性与人评。
8. 自适应触发、早停、预算分配、模型选择与级联策略。
9. 与 OpenRouter Fusion 及相关开源/论文系统的横向比较。
10. LiteLLM 集成、开放研究资产、复现包与上游贡献策略。

## Deliverable Structure
- 一页式结论摘要
- 项目与竞品机制对照
- 相关研究地图与研究空白
- 推荐研究问题、实验矩阵和统计设计
- 六人分工、里程碑、预算分级与论文路线
- 风险、不确定性和来源附录

