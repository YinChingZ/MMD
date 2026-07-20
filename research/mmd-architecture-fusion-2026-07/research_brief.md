# Research Brief：MMD 集中式与分布式协调架构融合

## Objective

- Topic：在保留 MMD 现有 coordinator 架构的基础上，研究 Quick、Standard 与 Planning 三种模式如何选择集中式、分布式或混合式 claim 治理。
- Decision context：MMD 是 Paper A 研究多模型审议性能来源的实验载体；架构既要支持产品使用，也要允许对 coordinator、投票、审议和信息保留做可识别的对照。
- Intended reader：MMD 架构与研究方案负责人。
- Expected expertise level：熟悉多模型协议、实验设计、trace 与成本分析。
- Deliverable format：一份带来源、候选方案比较、推荐架构、实验矩阵和迁移建议的中文报告。
- Source/data cutoff：2026-07-20；本地源码与研究文档以当前 workspace 状态为准。

## Hard Requirements

- 保留 coordinator 作为主流且有研究价值的架构，不预设分布式方案必然更优。
- 支持关键判断的来源必须可追溯并标注日期；本地实现判断提供文件定位。
- 分开讨论产品模式选择和 Paper A 的实验条件，避免产品命名替代因果 estimand。
- 明确不确定性、反例、成本与失败语义；不虚构尚未实测的性能数字。
- 至少比较集中式优先、双轨并存和按模式混合三种立场。

## Analysis Dimensions

1. 认知权力拓扑：单 coordinator、peer alignment、集中—分布混合各自控制什么。
2. 模式—任务匹配：Quick、Standard、Planning 的任务结构是否要求不同治理方式。
3. 因果可识别性：怎样共享 proposals、revisions 和 ledger，才能隔离 vote、deliberation、normalize 与 compose 效应。
4. 信息保真：遗漏、错误合并、错误拆分、少数意见与最终文字失真的不同风险。
5. 最终答案构造：闭集决策、开放式综合和长文规划是否能使用同一种 renderer。
6. 成本与延迟：调用数、串行深度、重复上下文、并行扇出与 repair 成本。
7. 可靠性与扩展性：coordinator 单点失败、peer quorum、阈值敏感性及 Planning 的主题膨胀。
8. 可追溯与复现：manifest、trace、artifact branching、版本和 backend parity。
9. 产品与研究接口：用户可理解的模式数量、默认值、实验 condition 与协议版本的分离。

## Deliverable Structure

- Executive summary
- 证据与现有架构约束
- 候选融合方案比较
- 推荐的按模式架构
- Paper A 实验矩阵与 estimand
- 成本、失败、trace 与迁移要求
- 反方观点、风险和不确定性
- 来源附录
