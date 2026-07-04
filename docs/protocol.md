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

## 使用方式

```ts
import {
  ProposalSchema,
  CritiqueSchema,
  RevisionSetSchema,
  NormalizeResultSchema,
  VoteSetSchema,
  FinalAnswerSchema,
  classifyCandidate,
  checkQuorum,
  makeRunId,
  scopedId,
  getBudget,
} from "@mmd/protocol";
```

`apps/cli` 是这个协议的第一个消费者（M1 里程碑），CLI 里的每一次模型调用结果都应该先过对应的 zod schema 校验，再进入下一阶段。
