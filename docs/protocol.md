# MMD Protocol v3

*[English](protocol.en.md) · [版本与兼容规则](versioning.md)*

本文描述 `main` 当前实现的新运行语义。语言无关 contract、错误码和 parity fixtures 位于 [`contract/mmd-protocol-v3/`](../contract/mmd-protocol-v3/)。新运行写 `mmd.v3` / `mmd.trace.v3`；旧结果可以继续读取，但不得补造旧运行没有保存的 v3 lineage。

## Host orchestrator 与 LLM coordinator

MMD 始终有 host orchestrator。它是代码，不是模型，负责：

- 校验 mode、governance、模型集合和 experiment manifest；
- 调度 phase、重试、quorum、成本熔断和 partial failure；
- 分配 artifact、candidate set、candidate、call 和 output span ID；
- 执行 complete-link、共识分类和 deterministic fallback；
- 保存 trace、artifact 和最终结果。

LLM coordinator 是模型角色，只在集中式 Normalize、Compose、Outline 和 GlobalCompose 等指定调用中生成结构化结果或 prose。`peer-governed` 表示认知候选集由 peers 的 Align 结果形成，不表示系统“没有 orchestrator”。

## 请求与治理

- `mode`: `quick | standard | planning`
- `governance`: `centralized | distributed`
- Quick 只接受 centralized，普通产品严格使用两个不同模型。
- Standard 缺省 centralized；distributed 只有在 `experimentManifest` 是 `mmd.v3` 且包含版本化 `alignment_policy` 时启用。
- Planning 只接受 centralized。
- coordinator 必须属于显式选择的模型集合；非法组合返回结构化配置错误，不静默降级。

公共 HTTP API 当前使用 camelCase，例如 `experimentManifest` 和 `modelIds`；contract artifact/trace JSON 使用 snake_case。两者是不同的兼容边界。

## Phase graph 与权威结果

### Quick：centralized N=2

```text
Propose_N → Normalize_C → Classify_host → Compose_C
```

Quick 没有 Critique、Revise 或显式 Vote。host 将每个 candidate 的不同来源模型转换成隐含 approve ballots，再用同一确定性分类函数计算标签。当前 trace 保存这些隐含 ballots 和完整计算输入，但尚未用独立枚举字段标明 `source_coverage`；正式研究前应补该字段，避免与 Standard 的真实 ballots 混称。

普通 Quick 无重试时为 4 次模型调用。Paper A 的 `Traceable-Quick-C@N3` 是研究 manifest 条件，不是产品 Quick 的第二种默认。

### Standard-C：centralized/classic

```text
Propose_N → Critique_N → Revise_N
→ Normalize_C → Vote_N → Classify_host → Compose_C
```

Normalize 形成带 `source_claim_ids` 的 candidate set；Vote 后的 classification ledger 是权威结果。Compose 只能根据 ledger 生成展示文字，失败时 host 返回 deterministic canonical fallback，不改变 ballots 或 classifications。

无重试调用数为 `4N + 2`；N=3 时为 14。

### Standard-D：distributed/peer-governed，实验性

```text
Propose_N → Critique_N → Revise_N
→ Align_N → complete-link_host → Vote_N → Classify_host → Compose_C
```

每个 peer 对修订后 claim pairs 输出 `equivalent | distinct | conflict | uncertain`、cannot-link、confidence 和 reason。host 按稳定顺序执行保守 complete-link：cannot-link 永不合并，每条修订后 claim 恰好进入一个 cluster，证据不足时保持分离。

当前实现仍调用一次 coordinator Compose 作为呈现层，因此无重试调用数是 `5N + 1`，N=3 时为 16。分类 ledger 仍是权威结果；不过研究报告要求的 deterministic-render 端点、non-authoritative prose 标识和 fidelity checker 尚未完整实现。该研究目标若跳过 Compose，N=3 才是 15 次调用。

当前产品/API 一次只执行 C 或 D 其中一条路径。共享同一 post-revision root 的 CN/DN 双分支和 CN+CR、CN+DR、DN+CR、DN+DR 完整 2×2 runner 仍是 research target，不能描述成当前产品能力。

### Planning：centralized + GlobalCompose

```text
Outline_C
→ add cross_cutting_risks_and_omissions_host
→ parallel topics:
   Propose_N → Critique_N → Revise_N → Normalize_C → Vote_N → Classify_host
→ GlobalCompose_C
```

Planning v3 不再调用 per-topic SectionCompose。每个 topic ledger 完整保存在 trace，最终只有一次 GlobalCompose 产生权威 `PlanningFinalAnswer`。每个实质 span 保存 host 分配的 `span_id` 和 candidate lineage；跨主题推导使用 `coordinator_synthesis`，未采用 strong candidate 必须给出 omission reason。

当前容量保护在序列化 candidate 输入超过 60,000 字符时，将每条 candidate text 截至 1,200 字符，记录 `topic_briefs` artifact，再检查一次；仍超限则进入结构化 fallback。它尚未使用模型 context-window metadata，也不是由 coordinator 生成的语义摘要。后者是研究报告中的后续目标，不是当前事实。

无重试调用数为 `2 + T(4N + 1)`，其中 T 是实际 topics 数量；一次 Outline 和一次 GlobalCompose 包在 topic calls 之外。

`PlanDocument` 仍由代码从 `planning_final` 和 topic ledgers 派生，供现有 CLI/UI/reader 兼容使用。它不是 v3 权威输出，也不会反馈进 GlobalCompose。

## Classification basis 与 lineage

- candidate set 和 candidate ID 由 host 分配，模型自报 ID 会被覆盖。
- Quick 当前保存 coverage-derived 隐含 ballots；Standard 保存显式 ballots。
- `classification_basis` 保存 candidate set、expected voter count、ballots、approve ratio、label 和 partial。
- 当前 schema 尚没有独立 `basis_kind`；文档和研究数据不得仅凭字段名声称它已经区分两种证据。
- Standard-D 保存 alignment judgments、policy 和 merge/reject decisions。
- Planning 保存 topic→candidate→output span lineage。

## Quorum、重试与失败

quorum 为 `ceil(N × 2/3)`。fan-out phase 可在部分模型失败但仍达 quorum 时继续，并把结果标为 partial。未达 quorum 的必要 panel phase 会终止当前 flat run；Planning 用 `Promise.allSettled` 隔离 topic，只有所有 topic 都失败时才使整个 Planning run 失败。

coordinator 的结构化调用允许 schema repair，并对 provider failure 最多额外重试一次。每次尝试都计入 usage/cost；文档中的基础调用数不含 retry/repair。

当前 fallback 规则：

- Normalize_C 失败：按现有 claims 生成 deterministic fallback candidate set，保留已完成 artifacts。
- Compose_C 失败：返回 deterministic canonical ledger rendering。
- standalone Standard-D 的 Align 未达 quorum：当前 distributed run 失败；未来配对 2×2 runner 才应只标记 DN branch failed、保留 CN branch。
- Outline_C 失败：只保留固定的 `cross_cutting_risks_and_omissions` topic 并继续。
- 单个 Planning topic 失败：其他 topic 继续。
- GlobalCompose_C 失败或压缩后仍超限：保留 topic ledgers，返回带 candidate lineage 的结构化 fallback。

## `mmd.trace.v3` 与持久化

trace 当前保存：

- proposals、不可变 post-revision claims、artifact parents；
- candidate sets、Align/聚类决策、ballots 和 classification inputs；
- Planning span lineage 和 strong-candidate omission reasons；
- call phase/model/role/attempt/status、usage、cost、latency；
- quorum、failures，以及 normalization/alignment/decision-rule/renderer versions。

当前 trace 尚未完整保存研究方案要求的 prompt version/hash、provider revision 和独立 classification-basis kind。这些是 parity/research gate 的待办，不能写成已完成。

运行状态与 artifacts 分开持久化。每个 artifact 完成时，API 的 trace callback 更新 `run_traces` 和 `run_artifacts`；最终 envelope 同时保存在 `run_results.trace`，Planning 权威输出保存在 `run_results.planning_final`。后续 phase 失败不会删除之前的 artifact。

## Contract 与验收

TypeScript 与 Python 实现必须共同执行 `contract/mmd-protocol-v3/fixtures/`，比较 phase、ID、candidate set、ballot、classification input、lineage、failure、quorum 和 usage，而不是只比较最终文字。complete-link 属性测试必须证明：

- 输入和响应顺序不改变结果；
- cannot-link 永不合并；
- 每条 raw claim 恰好属于一个 cluster。

版本升级和历史读取规则见 [versioning.md](versioning.md)。
