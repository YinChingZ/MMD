# Self-Review

Reviewer stance: skeptical domain expert.

## Substantive Weaknesses Found
1. Issue: 初稿把 120 题 pilot、15–20% 人评等工程起点写得太像统计定理。
   - Why it matters: 审稿人会要求功效、方差和最小有意义效应的依据；固定比例可能浪费预算或导致低功效。
   - Revision made: 明确这些只是 pilot 起点；confirmatory 样本量用 task-level variance 与预算做功效模拟，人评比例由 judge-human alignment 和置信区间调整。
2. Issue: “高多样性 panel”与“成员更强/更贵”可能严重混杂，初稿没有充分限定因果语言。
   - Why it matters: 不匹配 solo ability 和成本，就不能把质量增益归因于多样性。
   - Revision made: 加入 ability/cost/panel-size 匹配设计、预设协变量，并把无法随机化的厂商/训练来源结论限定为受控关联。
3. Issue: compute-matched 设计暗示闭源 provider 会忠实执行相同 seed/temperature/reasoning 参数。
   - Why it matters: 不同 API 的参数语义和支持程度不同，表面相同并不代表同等计算。
   - Revision made: 要求记录实际支持参数；不支持时依赖独立重复，并禁止把请求等价写成执行等价。
4. Issue: 初稿预算中的 provider 50% 上限过于僵硬。
   - Why it matters: 某些 snapshot 只能由单一 provider 提供，硬上限可能破坏研究问题。
   - Revision made: 改为可调整的风险模板，并要求替代 route、中间产物和依赖披露。
5. Issue: 原计划只简短提到隐私/许可证，没有把 provider 条款和 benchmark 原文发布限制纳入基础设施 gate。
   - Why it matters: trace 可能包含受限制题目、模型输出、用户信息或 secrets，影响数据发布合法性。
   - Revision made: 在四周工程冲刺中新增合规清单和公开数据脱敏要求。

## Final Checks
- Topic-specific dimensions: yes; protocol stages, model diversity, coordinator bottleneck, Fusion/DRACO and LiteLLM are specific to MMD.
- Dated source support: yes; external quantitative claims have dated primary sources, vendor claims are labeled.
- Explicit uncertainty: yes; missing raw Fusion data, closed-model versioning and absent MMD real benchmark are explicit.
- Multiple perspectives: yes; performance, cost, audit/calibration and negative-result paths are all retained.
- Non-cosmetic revisions: yes; causal language, sampling, evaluation, budget and compliance design changed.
