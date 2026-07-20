# Critical Analysis：MMD 的真实差异化

## 分类边界
- 直接竞品：Amiable Dev LLM Council、Council Engine、Karpathy LLM Council、litesquad、OpenRouter Fusion、MALLM、RECONCILE，以及部分 Star Chamber/llmcouncil 协议。
- 强基线但非协商：LLM-Blender、MoA。它们用于检验收益是否只是“多生成 + 选择/融合”。
- 邻近基础设施：AutoGen、CAMEL、CrewAI、MetaGPT、AgentVerse。它们能搭建类似流程，但默认目标是任务协作/工具执行，不提供 MMD 的 claim 共识语义。
- 专用评审：ChatEval/Language Model Council。它们协商“如何评价模型/输出”，不直接生成面向用户的决策答案。

## MMD 的独特组合，而非独占单项
- 独立提案、互评、修订、显式 ballot、确定性比例分类、critical objection 保护、claim-level lineage、quorum、成本熔断、planning 分题、BYOK/Web/UI 同时出现，目前仍较少见。
- 但其中每个单项已有相邻实现：匿名互评/Borda（Amiable/Karpathy）、多轮说服和置信度投票（RECONCILE）、可换决策协议（MALLM）、分歧可见（Council Engine）、确定性 consensus bucket（Star Chamber）、成本/失败降级/早停（Amiable）。
- 因而可靠定位是“审计优先、命题级共识的完整产品实现”，不是“首个/唯一多模型协商系统”。

## 控制权分析
- MMD 相比 Chairman/judge 系统，确实把“支持度标签”从单一 LLM 手中移到纯函数。
- 但 Normalize coordinator 决定哪些原始 claims 被合并、遗漏或改写；Compose coordinator 决定最终文本强调什么。`source_claim_ids` 可让遗漏被事后发现，却不能阻止遗漏。
- 所以“无单一模型拥有裁决权”过强；准确表述是“共识标签不由单一模型直接裁定，候选集和最终表述仍存在 coordinator 权力”。

## 共识不等于正确
- MMD 的比例标签以 `expectedVoterCount` 为分母，适合表达参与者支持结构与 partial 状态。
- 但模型错误高度相关、会受多数意见影响；critical veto 也可能来自最弱模型。没有校准数据时，`strong_consensus` 不应在 UI/文案中暗示“高概率正确”。
- MMD 的优势应转向“支持结构、反对严重度和来源可审计”，并另外增加 correctness calibration/外部证据层。

## 与最强对手的条件化结论
1. 面向普通用户的快速高质量回答：Fusion、Karpathy/Amiable Council、MoA 更短、更易懂，MMD standard 可能过重。
2. 面向可审计决策和研究：MMD 的 claim lineage、revision trace、显式 objection 与 deterministic label 更有价值。
3. 面向 MAD 机制实验：MALLM 的协议模块化和内置评测明显领先；MMD 的优势是产品/持久化/可靠性，而不是实验自由度。
4. 面向 CI/代码门禁：Amiable 的机器 verdict、Star Chamber 的代码位置聚类更贴近场景；MMD 尚缺领域 schema 和校准门槛。
5. 面向开放式工具任务：AutoGen/CrewAI/Magentic-One 更强；MMD 的 web search 只是 propose/critique 的受限内建能力，不是完整 agent loop。

## 反直觉洞见
MMD 最可防守的资产可能不是“更好的最终答案”，而是一个可计算的 dissent/lineage 数据生成器。只要证明 dissent survival、candidate recall、revision flip 和 objection severity 能预测错误或人工升级价值，MMD 即使平均分不超过简单 ensemble，也仍有独立价值。反之，如果这些过程信号不校准，六阶段只会成为昂贵而复杂的解释性外观。

## 条件化结论
| 结论 | 成立条件 | 主要风险 |
|---|---|---|
| MMD 是差异化明显的审计型决策工作台 | claim lineage 完整、异议可见、用户重视过程证据 | coordinator 遗漏使追溯只剩形式 |
| MMD standard 能提升答案质量 | 模型错误低相关、批评能纠错、任务需要综合判断 | 收益可能全部来自更多采样/更强 composer |
| MMD 比 Council 生态更可靠 | quorum/成本/持久化经真实故障与规模测试 | Amiable 的早停、降级、MCP 和 benchmark 已快速追平或领先 |
| MMD 能成为研究平台 | 协议模块可替换、加入 compute-matched baselines 与统一评测 | 当前六阶段较固定，弱于 MALLM 的实验配置空间 |
