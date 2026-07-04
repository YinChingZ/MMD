# Deliberation Protocol v0.1

本文档描述 `packages/protocol` 里实现的协议，是 [multi-model-deliberation-tech-design.md](../multi-model-deliberation-tech-design.md) 第 5 章和 [multi-model-deliberation-dev-roadmap.md](../multi-model-deliberation-dev-roadmap.md) M0 阶段修订的落地版本。CLI/backend 都应该 import `@mmd/protocol`，不要各自重新定义 schema。

## 六个阶段

| 阶段 | schema 文件 | 说明 |
|------|-------------|------|
| Propose | `src/schemas/propose.ts` | 每个模型只看到用户问题，独立回答，拆成若干 claims |
| Critique | `src/schemas/critique.ts` | 每个模型评议其他模型的 claims |
| Revise | `src/schemas/revise.ts` | 每个模型根据评议更新自己的立场 |
| Normalize | `src/schemas/normalize.ts` | 合并语义相近的 claims 成 candidate claims |
| Vote | `src/schemas/vote.ts` | 每个模型对 candidate claims 表决 |
| Compose | `src/schemas/compose.ts` | 根据共识分类生成最终答案 |

所有阶段的输入输出都是 zod schema，校验失败时上层（CLI/backend）应该走"重试/让模型修复 JSON"的路径，而不是直接让整个 run 失败（对应技术设计文档 12 章"结构化输出不稳定"风险）。

## 协议级约束（M0 加固项，不是实现建议，是硬性规则）

### 1. Normalize 阶段必须保持可追溯（对应风险 #2）

`CandidateClaimSchema.source_claim_ids` 是必填且非空数组（`src/schemas/normalize.ts`）。任何展示最终结果的界面/输出都必须能从 candidate claim 追溯回合并前的原始 claims——因为 normalize 阶段的合并取舍本身就带有隐含裁判权，透明可追溯是唯一的兜底手段，不能被简化掉。

### 2. 共识分类是比例制，不是硬编码模型数（对应风险 #3）

`src/consensus.ts` 的 `classifyCandidate` 接受任意 `expectedVoterCount`，用比例阈值判定：

- `approveRatio >= strongApproveRatio`（默认 1.0）→ `strong_consensus`
- 存在 `critical` 反对 → 直接 `disputed`，不能被多数票吞掉
- 存在 `major` 反对 → 视 approveRatio 是否达到 qualified 门槛，分流到 `disputed` 或 `rejected`
- `approveRatio >= qualifiedApproveRatio`（默认 0.66）→ `qualified_consensus`
- `approveRatio <= rejectApproveRatio`（默认 0.34）→ `rejected`
- 其余 → `disputed`

阈值可通过 `ConsensusThresholds` 覆盖，默认值见 `DEFAULT_CONSENSUS_THRESHOLDS`。模型数从 3 变成 5、7 都不需要改这个函数（`test/consensus.test.ts` 里有对应的多模型数测试）。

**投票 schema 的一处修订**：原始设计里 compose 规则依赖"critical/major object"，但投票阶段的 `BallotSchema` 本身不带 severity。这里给 `vote === "object"` 的投票加了必填的 `objection_severity` 字段（`src/schemas/vote.ts`），否则 `classifyCandidate` 无法区分 disputed 和 rejected。

### 3. Claim/candidate id 必须按 run 隔离（对应风险 #5）

`src/ids.ts` 提供 `makeRunId()` / `scopedId(runId, localId)` / `parseScopedId(id)`。所有持久化到数据库的 claim/review/vote id 都应该是 `scopedId` 的结果（`${runId}:${localId}`），而不是模型生成的裸 `a_c1` 这种短 id，避免跨 run 主键冲突。

### 4. 每阶段有 quorum，单模型失败不应该拖垮整个 run（对应风险 #4）

`src/quorum.ts` 的 `checkQuorum(respondentCount, modelCount, ratio = 2/3)` 返回：

- `required`：法定响应人数（默认 2/3 向上取整，至少 1）
- `met`：是否达到法定人数
- `partial`：是否有模型未响应（即使达到法定人数，也要在结果里标注 partial）

Orchestrator 的实现规则：某阶段未达到 quorum → 该阶段标记为 `partial`，涉及的内容在最终结果里显式提示"仅基于部分模型响应"；达到 quorum 但有模型缺席 → 缺席模型的后续阶段直接跳过，不阻塞整体流程。不允许因为一个模型超时/报错就让整个 run 失败。

### 5. 延迟/成本预算和 quick mode 是具体的协议路径（对应风险 #1）

`src/budget.ts` 定义两条路径：

- `STANDARD_BUDGET`：3 模型、1 轮 critique，跑完全部六个阶段，目标 p50 ≤ 60s，p95 ≤ 120s（基线数字待 M1 用真实数据校准）。
- `QUICK_MODE_BUDGET`：2 模型，`phases` 为 `["propose", "normalize", "compose"]`——跳过 critique/revise/vote，不是"少跑几轮"这种模糊说法。保留 normalize 是因为没有显式投票时，仍需要用 candidate 的 `source_claim_ids` 覆盖了几个模型来推断共识强度（每个来源模型视为一票隐含 approve），否则 compose 阶段完全没有共识信号可用。

`getBudget(mode)` 返回对应配置，orchestrator 应该据此决定要跑哪些阶段，而不是自己再判断一遍。

## v0.2：Planning Mode（长输出/综合规划支持）

v0.1 的六阶段协议假设所有 claim 是一个扁平的、互相可比较/可合并的集合——这对"一问一答"式的窄问题效果很好，但对"给一个项目做全面技术规划"这种长输出场景有结构性缺口（claim 数量爆炸导致 critique 的 O(n²) 成本失控、跨主题的 claim 被硬塞进同一个合并/投票池、compose 输出扁平不适合结构化文档）。v0.2 新增 `mode: "planning"`，按主题（topic）拆分复用现有六阶段协议来解决这些问题，而不重新设计共识机制本身。

### Outline 阶段：为什么用单一 coordinator，而不是多模型协商

Planning 模式在 Propose 之前多一个 **Outline** 阶段：一次 coordinator 调用（`buildOutlinePrompt` / `OutlineResultSchema`），把问题拆成最多 8 个主题（`RunBudget.maxTopics`，同时在 `OutlineResultSchema` 里用 `.max(8)` 做了 schema 层的硬限制，不只是 prompt 文字说明）。

这里没有像 Normalize 阶段那样要求多模型参与决策，是刻意的选择：本文档第 1 条约束（"Normalize 阶段必须保持可追溯"）针对的是**已经产生的、带真值判断的 claim 内容被合并时可能被抹掉异议**——outline 阶段还没有任何 claim 产生，只是决定"分几个主题讨论"，一个不太好的主题划分是覆盖面问题，不是真值/异议被抹除的问题，而且完全可恢复：后续 Propose 阶段仍然是所有模型各自在每个主题下独立提案，如果 outline 漏了什么，模型可以在对应主题里用 `risk` 类型的 claim 指出遗漏。多模型 outline 至少多两轮真实网络往返，真实推理模型每阶段普遍要 90-250 秒（见下方"真实耗时基线"），为一个可恢复、低风险的决策多付出这个延迟成本不划算。

### 按主题循环复用六阶段协议

每个 outline topic 独立跑一次完整的 propose→critique→revise→normalize→vote→classify（`apps/cli/src/orchestrator.ts` 的 `runTopicDeliberation`），所有主题**并行**执行（`Promise.all`/`Promise.allSettled`，不串行——避免延迟随主题数线性增长）。这意味着：

- `classifyCandidate`、`checkQuorum`、`fanOutWithQuorum` 等核心函数完全不需要知道 topic 的存在，按主题分别调用即可，不做任何改动。
- Claim/candidate id 在 `stampProposal` 里扩展成 `${topicId}::${modelId}::c${i}`（原本是 `${modelId}::c${i}`），保证跨主题不冲突，同时不touch `src/ids.ts`（那个模块解决的是跨 run 的存储键隔离，是另一个维度）。
- 单个主题的 quorum 失败会让该主题的 `runTopicDeliberation` 抛出 `DeliberationQuorumError`，但 `runPlanningDeliberation` 用 `Promise.allSettled` 收集结果——一个主题失败不会拖垮整个规划文档（同一个"单模型失败不阻塞整个 run"的原则，往上提了一层），除非**全部**主题都失败才会整体报错。

### Section Compose：为什么 executive summary 是确定性拼接，不是模型调用

每个主题单独跑一次 section-compose（`buildSectionComposePrompt` / `SectionAnswerSchema`，字段等价于 `FinalAnswerSchema` 加上 `topic_id`/`title`/`tldr`）。最终文档的 `executive_summary` 是**用代码把每个 section 的 `tldr` 拼起来**，不再调一次模型做"跨主题综合摘要"——如果加这一次调用，等于让 compose 重新变成跨主题做判断的裁判，正是 4.1/4.3 原则一直在避免的失败模式。`FinalAnswerSchema` 本身完全不变，`SectionAnswerSchema` 是独立的新 schema，不是把 `FinalAnswerSchema` 改成一个"可能有 topic 也可能没有"的联合类型。

### 预算与 CLI

`getBudget("planning")` 返回 `PLANNING_BUDGET`：每个主题跑完整六阶段（`phases` 与 `STANDARD_BUDGET` 相同），外加 `maxTopics: 8`。CLI 用 `--mode planning` 触发。

### 真实耗时基线（截至本文档更新时）

用真实模型（Volcengine/DeepSeek 系列推理模型）跑过的窄问题（standard 模式）单次耗时在 96-250 秒之间，远高于 `STANDARD_BUDGET` 里当初凭 mock 猜测的 p50 60s / p95 120s 目标——这两个数字还没有用真实数据校准，是已知的后续待办，不在这次 v0.2 改动范围内。Planning 模式因为每个主题都要跑完整六阶段，单个主题的耗时预期和 standard 模式的单次 run 类似，多个主题并行执行，所以总耗时约等于"最慢的那个主题"而不是"耗时总和"。

## 使用方式

```ts
import {
  ProposalSchema,
  CritiqueSchema,
  RevisionSetSchema,
  NormalizeResultSchema,
  VoteSetSchema,
  FinalAnswerSchema,
  OutlineResultSchema,
  SectionAnswerSchema,
  PlanDocumentSchema,
  classifyCandidate,
  checkQuorum,
  makeRunId,
  scopedId,
  getBudget,
} from "@mmd/protocol";
```

`apps/cli` 是这个协议的第一个消费者（M1 里程碑），CLI 里的每一次模型调用结果都应该先过对应的 zod schema 校验，再进入下一阶段。
