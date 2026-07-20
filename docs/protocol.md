# MMD Protocol v3

*[English](protocol.en.md)*

本文档描述 `main` 新执行使用的 `mmd.v3` 协议。语言无关的 wire
contract、错误码与黄金向量位于 `contract/mmd-protocol-v3/`。旧结果仍可读取，
但读取端不得伪造 v3 血缘；新执行只写 `mmd.trace.v3`。

## 请求与治理

- `mode`: `quick | standard | planning`
- `governance`: `centralized | distributed`
- Quick 固定 centralized，且恰好使用两个不同模型。
- Planning v3 首版固定 centralized。
- Standard-D 只有在 `experimentManifest` 包含版本化
  `alignment_policy` 时启用；否则返回结构化配置错误。
- coordinator 必须属于本次显式允许的模型集合，不再静默退回任意模型。

Standard 的研究阈值只属于 experiment manifest，不作为普通产品开关。

## 三种流程

### Quick

Propose → Normalize → Classify → Compose。没有显式选择模型时，入口稳定选择
默认 coordinator 和一个不同模型；无法组成 N=2 时拒绝运行。分类以原始 claim
覆盖隐式形成 ballot，最终仍记录 candidate set 和 classification basis。

### Standard

两种治理共用 Propose → Critique → Revise → immutable postRevisionClaims →
Vote → Classify → Render。

- Standard-C：coordinator Normalize。
- Standard-D：每个 peer 运行 Align，输出 `equivalent | distinct | conflict |
  uncertain`、cannot-link、置信度与原因；宿主按稳定顺序执行 complete-link
  聚类。cannot-link 永不合并，每条修订后 claim 恰好属于一个 cluster。

每个 candidate set 独立投票和分类。确定性 classification ledger 是权威结果；
模型 Compose 只是展示层，失败后返回确定性 canonical fallback，不改变 ledger。

### Planning

Outline → 每主题 Standard-C ledger → 一次 GlobalCompose。Outline 始终补充稳定的
`cross_cutting_risks_and_omissions` 主题。v3 不再执行 per-topic
SectionCompose，也不把 TLDR 拼接或旧 `PlanDocument` 当作权威结果；旧 UI 所需的
`PlanDocument` 只是从 v3 输出派生的兼容投影。

GlobalCompose 输入包含 topic、candidate ID、classification 与正文。每个输出 span
保存 `source_candidate_ids`；跨主题推导标为 `coordinator_synthesis` 并保存
`derived_from_candidate_ids`；有意省略 strong claim 必须记录原因。

组合前使用模型 token/context metadata 判断容量。超限时只做一次可追踪的 topic
brief 压缩；仍失败时返回各 topic ledger 和结构化 fallback。

## ID、quorum 与重试

artifact、candidate set、candidate、call 和 output span ID 全由 host 生成；模型
返回的权威 ID 一律覆盖。wire format 统一为 snake_case。

quorum 使用 `ceil(N × 2/3)`。coordinator 阶段执行初次调用和恰好一次重试；两次
都失败时保留已经完成的 claims、ballots、candidate sets 和 topic ledgers，并把
fallback 标记为 partial。Align quorum 失败只使对应 distributed candidate set
失败。

## `mmd.trace.v3`

trace 保存：

- 原始 proposal 与不可变修订后 claims；
- artifact 父子关系、candidate-set 映射、Align 判断与聚类日志；
- ballots、classification basis 与 canonical render 来源；
- GlobalCompose span 血缘和 strong-claim omission 原因；
- 每次 call 的 phase/model/role/attempt/status、usage、cost、latency；
- quorum、partial failure，以及所有协议/算法版本。

非协议的产品诊断只能放在 `extensions`，消费者不得用它推导协议语义。

## 持久化

运行状态与制品分开保存。每个 phase 完成即通过 trace callback 写入
`run_traces`/`run_artifacts`；后续 coordinator 或 GlobalCompose 失败不会回滚已经
完成的制品。`run_results.trace` 保存最终 envelope，`planning_final` 保存权威
Planning 输出。

## 验收

TypeScript 与 Python 共同执行 `contract/mmd-protocol-v3/fixtures/`，逐字段比较
phase、ID、ballot、classification basis、lineage、failure、quorum 和 usage，不能
只比较最终文本。complete-link 的属性测试必须证明输入/响应顺序无关、cannot-link
永不合并、所有 raw claim 恰好归属一个 cluster。
