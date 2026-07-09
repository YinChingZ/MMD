# 流式输出 / 工具调用 / 多模态输入 / JSON 输出 —— 可行性与实施路径

本文档分析在现有架构基础上支持以下四项能力的可行性、改动范围和实施顺序：

1. 流式输出，实现实时进度检查
2. Tool calling（工具调用）
3. 多模态 input
4. JSON output（按用户指定格式输出）

这四项里，现有系统已经有**内部固定 JSON 协议输出**（各阶段 zod schema + repair 重试）；本文档里的 "JSON output" 特指**用户在发起 run 时指定最终输出 JSON 格式**，这一能力尚未实现。本文档是设计分析，不是已落地功能的说明（不同于 [protocol.md](protocol.md)/[deployment.md](deployment.md) 这类描述现状的文档）。**这四项能力已正式列入开发路径，作为 [roadmap.md](roadmap.md) 的 M6 里程碑，按本文档第 5 节的推荐顺序拆成 M6.1–M6.6；roadmap 的"M6"一节只列范围、顺序和验收方向，详细可行性与取舍以本文档为准（分工同 protocol.md/roadmap.md：那边讲"做什么、按什么顺序"，这里讲"为什么这么设计"）。**

## 结论摘要

| 能力 | 可行性 | 改动范围 | 是否需要动 `@mmd/protocol` schema | 建议优先级 |
|------|--------|----------|-----------------------------------|------------|
| 用户自定义 JSON output | 高 | 中，API + orchestrator 最终格式化层 + DB + web；可复用现有结构化校验思路 | 不改六阶段 schema；建议新增独立 `outputFormat`/`userOutput` 类型 | 1 |
| 细粒度进度事件（per-model） | 高 | 小，`fanout.ts` + `orchestrator/index.ts` | 否 | 2 |
| Claim/item 级别渐进式解析（propose/critique/revise/vote/normalize） | 中高 | 中，新增增量数组提取器 + provider 流式接口 + 新 `RunEventType` | 否，复用各 phase 已导出的子 schema（`ClaimSchema`/`ReviewSchema`/`RevisionSchema`/`BallotSchema`/`CandidateClaimSchema`） | 3 |
| Token 级流式（仅 compose/section-compose 自由文本） | 中 | 中，provider 接口 + SSE 旁路 + web | 否 | 4 |
| 多模态输入 | 中 | 中大，protocol 输入类型 + provider + API + web + 存储 | 是（仅 propose 入口）| 5 |
| Tool calling（propose + critique） | 中 | 中大，两阶段共用同一套单轮工具机制，budget 需为这两阶段单独加往返余量 | 否 | 6（范围已收窄，风险点已从"违反协议"转为"同质化/成本"）|

## 0. 现状架构基线

在评估四项能力之前，先明确当前实现的关键约束，后面每一节都会引用这些点：

- **`ModelProvider.complete()` 是一次性的 `Promise<CompletionResult>`**（[provider.ts:40-43](../packages/model-adapters/src/provider.ts)），没有流式接口，也没有 `tools` 字段。`CompletionRequest` 只有 `systemPrompt: string` / `userPrompt: string` / `meta`。
- **现有 JSON 是内部固定协议 JSON，不是用户自定义 JSON**：`callStructured`（[structured.ts](../packages/model-adapters/src/structured.ts)）已经让 Propose/Critique/Revise/Normalize/Vote/Compose 按各自固定 zod schema 输出，失败时回填错误信息 repair 重试。它解决的是"协议内部数据结构稳定"，不是"用户想要什么 JSON shape，最终就返回什么 JSON shape"。
- **JSON 输出目前仍是"软约束 + 本地校验"**：`OpenAICompatibleProvider.complete()` 请求体里没有 `response_format`，所以现有结构化输出主要靠 prompt 要求 + 本地 zod 校验兜底，而不是 provider 原生 JSON schema 模式。
- **`OpenAICompatibleProvider.complete()`** （[openai-compatible.ts:73-101](../packages/model-adapters/src/providers/openai-compatible.ts)）请求体里没有 `response_format`，响应解析只读 `data.choices[0].message.content`，完全没有处理 `tool_calls` 字段。
- **`fanOutWithQuorum`**（[fanout.ts:38-67](../packages/model-adapters/src/fanout.ts)）用 `Promise.all` 并发调用每个模型，只有全部 settle 之后才返回结果——同一 phase 内谁先答完、谁还在跑，中间态完全不可观测。
- **进度事件是 phase 粒度**：`orchestrator/index.ts` 里每个 phase 只有 `phase_started`/`phase_completed` 两个 `RunEvent`（[index.ts:54-59](../packages/orchestrator/src/index.ts)），没有 phase 内部的模型级事件，更没有 token 级事件。
- **SSE 事件会被持久化后才广播**：`run-service.ts` 的 `onEvent` 回调把每个事件通过 `eventChain`（一条串行 Promise 链）写入 `run_events` 表之后才 `broadcaster.publish`（[run-service.ts:65-88](../apps/api/src/services/run-service.ts)），保证断线重连能用 `Last-Event-ID` 从 Postgres 回放。这个持久化路径是为"每个 phase 几个事件"设计的，如果不加区分地套用到"每个 token 一个事件"，写入量会暴涨几个数量级。
- **六阶段协议的输入输出全是纯文本 JSON claim**（`packages/protocol/src/schemas/*`），没有任何 schema 涉及图片/文件等其它模态。

## 1. 用户指定 JSON 输出格式

### 目标澄清

当前项目已经有固定 JSON 输出格式：六阶段协议分别产出 `ProposalSchema`、`CritiqueSchema`、`RevisionSetSchema`、`NormalizeResultSchema`、`VoteSetSchema`、`FinalAnswerSchema`，planning 模式还会产出 `PlanDocumentSchema`。这些 schema 是系统内部协议的一部分，服务于共识计算、可追溯展示、持久化和前端渲染。

这里要支持的新能力不是"让内部协议输出 JSON"（已经有了），而是：

> 用户在发起 run 时提供一个 JSON Schema / JSON 模板，系统完成现有多模型协商后，再把最终结果转换成用户指定的 JSON shape。

因此不建议把现有 Compose 阶段直接替换成用户 schema。否则 `FinalAnswerSchema`/`PlanDocumentSchema` 会消失，前端共识面板、分歧展示、traceability 和分享页都会失去稳定数据源。更稳的设计是**双层输出**：

```text
用户问题
  ↓
现有 Propose → Critique → Revise → Normalize → Vote → Compose
  ↓
内部稳定结果 FinalAnswer / PlanDocument（继续用于共识、追溯、UI）
  ↓
新增 FormatToUserJson
  ↓
userOutput（用户指定 JSON 格式，用于 API 消费/自动化/导出）
```

### 推荐 API 形状

`POST /api/conversations/:id/runs` 新增可选字段：

```ts
outputFormat?: {
  type: "json_schema";
  name?: string;
  schema: Record<string, unknown>;
  instructions?: string;
};
```

示例请求：

```json
{
  "question": "比较方案 A 和方案 B，给出推荐",
  "mode": "standard",
  "outputFormat": {
    "type": "json_schema",
    "name": "DecisionSummary",
    "schema": {
      "type": "object",
      "required": ["winner", "confidence", "reasons", "open_disputes"],
      "properties": {
        "winner": { "type": "string" },
        "confidence": { "type": "string", "enum": ["high", "medium", "low"] },
        "reasons": { "type": "array", "items": { "type": "string" } },
        "open_disputes": { "type": "array", "items": { "type": "string" } }
      },
      "additionalProperties": false
    }
  }
}
```

`GET /api/runs/:id/result` 在现有结果旁边新增：

```json
{
  "final": { "...": "现有 FinalAnswer" },
  "userOutput": {
    "winner": "方案 A",
    "confidence": "medium",
    "reasons": ["...", "..."],
    "open_disputes": ["..."]
  }
}
```

### 实施路径

1. **校验用户提供的 schema 本身**：API 层对 `outputFormat.schema` 做 JSON Schema 合法性校验，并加大小/深度限制。第一版建议只支持常见子集：`object`、`array`、`string`、`number`、`integer`、`boolean`、`null`、`enum`、`required`、`properties`、`items`、`additionalProperties`，避免一开始就支持复杂 `$ref`/递归 schema。
2. **把 `outputFormat` 传入 orchestrator**：`DeliberationInput` 增加可选 `outputFormat`。它不参与 Propose/Critique/Revise/Normalize/Vote，也不改变任何已有阶段 schema，只在最终 compose 之后使用。
3. **新增 `FormatToUserJson` 调用**：standard/quick 模式在 `final` 生成后调用；planning 模式在 `planDocument` 生成后调用。Prompt 约束应明确："只能根据内部最终结果转换格式，不得新增事实，不得重新裁判 disputed/rejected 项"。
4. **新增 schema-agnostic 校验/repair helper**：现有 `callStructured()` 只能接 zod schema；用户 schema 是运行时 JSON Schema。建议新增 `callJsonSchema()`：提取 JSON → 用 Ajv 校验 → 失败后把 validation errors 回填给模型 repair retry。这样能复用现有"模型可能吐坏 JSON，所以本地必须校验"的纪律。实现时建议直接复用 `structured.ts` 里已有的 `extractJson()`（```json 代码块提取逻辑），不要重新写一遍；`ajv` 会是这条路径上唯一的新增依赖（当前 `model-adapters` 只用 zod），加进 `package.json` 时值得单独说明用途，避免看起来像误加的包。
5. **持久化与 API 返回**：`run_results` 增加 `output_format jsonb`（可选，记录用户当时要求的格式）和 `user_output jsonb`（可选，记录校验通过后的结果）。`getResult()` 和前端 `RunResult` 类型同步暴露。
6. **前端 UI**：发起 run 表单增加一个可选 JSON Schema 输入区；完成页增加 "Custom JSON output" 面板，提供复制按钮。普通用户不填时行为完全不变。
7. **成本与事件**：`FormatToUserJson` 是额外一次模型调用，应纳入现有成本累加和 cost limit 检查。进度事件可以先复用 planning outline 的模式：`phase_started`/`phase_completed` 不扩展 `Phase` union，而是在 `data.step = "format_user_output"` 里标识，避免为一个可选导出层修改核心阶段枚举。

### 与 provider 原生 JSON mode 的关系

`response_format` / provider 原生 JSON schema 模式可以作为这个功能的**可靠性增强**，但不是这个功能本身。真正的产品语义是"用户指定最终 JSON shape"；原生 JSON mode 只是某些 provider 支持的生成约束手段。

后续可以给 `CompletionRequest` 增加可选字段：

```ts
responseFormat?:
  | { type: "json_object" }
  | { type: "json_schema"; jsonSchema: { name: string; schema: Record<string, unknown>; strict?: boolean } };
```

`OpenAICompatibleProvider.complete()` 支持时透传到请求体；不支持时仍走 prompt + 本地 Ajv 校验 + repair retry。无论 provider 是否声称支持 JSON schema，本地校验都不能省。

### 工作量与风险

中等。不需要推翻现有六阶段协议，也不应该让用户 schema 替代内部 `FinalAnswerSchema`/`PlanDocumentSchema`。主要风险在于用户 schema 复杂度控制、repair 失败体验、以及用户要求的字段无法从共识结果中可靠推导时如何表达。建议 prompt 明确允许输出 `null`、空数组或 schema 中约定的 `"unknown"`，而不是让模型为了满足字段编造内容。

如果只是做 provider 原生 `response_format`：

1. 给 `OpenAICompatibleOptions` 加一个可选字段：
   ```ts
   responseFormat?:
     | { type: "json_object" }
     | { type: "json_schema"; jsonSchema: { name: string; schema: Record<string, unknown>; strict?: boolean } };
   ```
2. `complete()` 的请求体里按需透传 `response_format`。
3. `callStructured` 保持不变，继续作为兜底校验层。

这仍然值得做，但它只是"内部固定 JSON 更稳"，不是用户这次要的"按我给的 JSON 格式输出"。

## 2. 流式输出与实时进度检查

这个诉求要拆成三个层次，机制和成本都不一样：**"phase 内谁先完成"**（per-model）、**"结构化阶段内部逐条 claim/review/revision/vote/candidate 的进度"**（per-item，这一轮新增的要求）、**"compose 这类自由文本本身的流式"**（token 级）。不能用同一套方案覆盖三者。

### 2.1 细粒度进度事件（per-model，phase 内部）

**问题**：现在一个 phase 里 3 个模型谁先答完完全不可见，前端只能等整个 phase 的 `fanOutWithQuorum` 全部 settle 才刷新一次。

**路径**：给 `FanoutOptions` 加一个可选回调：
```ts
export interface FanoutOptions {
  timeoutMs: number;
  retries: number;
  backoffMs: number;
  quorumRatio?: number;
  onSettled?: (result: FanoutResult<unknown>, index: number, total: number) => void;
}
```
在 `fanOutWithQuorum` 内部每个 `configs.map` 的 async 函数 resolve/catch 之后立即调用 `opts.onSettled?.(...)`，而不是等 `Promise.all` 整体完成。`orchestrator/index.ts` 在每次调用 `fanOutWithQuorum` 时传入这个回调，`emit` 一个新的 `RunEventType`（比如 `"model_responded"`），数据带 `{modelId, ok, latencyMs}`。

**工作量**：小。不需要改协议 schema，只涉及 `fanout.ts` 的一个可选参数和 `orchestrator/index.ts` 里六处 `fanOutWithQuorum` 调用点加一行 `onSettled`。这是"实时进度检查"里投入产出比最高的一项，建议第一批就做。

**注意**：`model_responded` 事件应该走和现有 phase 事件一样的持久化+广播路径（`run-service.ts` 的 `onEvent`），因为量级是"每个 phase × 每个模型"，不会引起写放大问题——不需要走 2.3 提到的"绕过持久化"特殊处理。

### 2.2 Claim/item 级别渐进式解析（propose / critique / revise / vote / normalize）

这是这一轮新增的要求：后面几个阶段要能看到逐条 claim/review/revision/vote/candidate 级别的进度，而不是等某个模型的整段响应完才刷新。

**为什么不能直接把半截 JSON 转发给前端做容错解析**：结构化阶段的输出是一个 JSON 对象，里面有一个"主数组"字段（`claims`/`reviews`/`revisions`/`votes`/`candidate_claims`）。如果只是把原始 token delta 转发给前端，让前端用某种"宽容 JSON 解析器"去尝试解析半成品文本，会有三个问题：
1. 每个客户端（`apps/web`，未来如果 `apps/cli` 也要接这个能力）都要各自实现一遍容错解析逻辑，重复且容易不一致；
2. 半成品对象在字段还没写完时做"尽力解析"，容易出现值先出现、类型误判的闪烁；
3. 违背项目一直以来的纪律——`structured.ts`/`docs/protocol.md` 都强调"模型输出必须经过 schema 校验才可信"，把未经校验的半成品数据直接推给 UI 等于绕开了这条纪律。

**推荐做法：后端做"增量数组元素提取"，只推送已经语法完整、且通过 schema 校验的条目。** 这是精确、非启发式的方案——LLM 的 token 流本身就是严格合法的 JSON 前缀，不需要"猜"一个对象是否写完，只需要跟踪字符串转义状态和 `{}`/`[]` 嵌套深度，在某个数组元素的 `}` 闭合、深度回到"数组内、元素之间"时，就能确定该元素已经语法完整：

1. 新增一个小型状态机（建议放在 `packages/model-adapters/src/streaming-json.ts`），只需要跟踪转义状态和嵌套深度，不需要一个完整的 JSON 解析器：
   ```ts
   export function createArrayItemWatcher(
     targetField: string,
     onItem: (rawItemJson: string) => void
   ): { feed: (delta: string) => void };
   ```
   每个 phase 对应哪个字段是静态已知的，建一张小表就够：
   ```ts
   const STREAM_ARRAY_FIELD: Partial<Record<Phase, string>> = {
     propose: "claims",
     critique: "reviews",
     revise: "revisions",
     vote: "votes",
     normalize: "candidate_claims",
   };
   ```
2. 每个数组元素已经有现成的、独立导出的 zod 子 schema——`ClaimSchema`、`ReviewSchema`、`RevisionSchema`、`BallotSchema`、`CandidateClaimSchema`（各自在 `packages/protocol/src/schemas/*.ts` 里，就是组成 `z.array(...)` 的那个元素类型）——不需要新建 schema，元素一凑齐就直接用对应子 schema 校验，比如 `ClaimSchema.safeParse(JSON.parse(rawItemJson))`。校验失败就丢弃这条 preview，不影响最终结果（权威数据始终来自 `callStructured` 对完整响应的校验，这里只是提前预览）。
3. **只在 `provider.completeStream` 可用时启用**（接口见 2.3）：`orchestrator/index.ts` 的 `structuredCall` 内部，如果 provider 支持流式，就一边用 `onDelta` 喂 watcher，一边照常累积完整文本；流结束后仍然走原来的 `callStructured` 全量校验 + repair 重试逻辑（不变，是最终真相）。`callStructured` 本身不需要改签名，改动全部封装在 `structuredCall` 的闭包内部。
4. 新增 `RunEventType`：`"item_progress"`，数据 `{phase, modelId, arrayField, index, item, attempt}`。`attempt` 对应 `callStructured` 的第几次尝试——如果第一次响应没通过 schema 校验触发了 repair 重试，第一次尝试里已经推送过的 item 就是"过期草稿"；前端简单起见可以在收到同一 phase/model 的新 `attempt` 时直接清空该组合已收到的 item 列表重新累积，不需要精细 diff。
5. **持久化**：`item_progress` 的量级是"每个 phase 的数组长度 × 模型数"，通常是几条到十几条，不是 token 那种成百上千条的量级，可以直接走和 `model_responded` 一样的标准持久化路径（`run-service.ts` 现有的 `eventChain`），不需要 2.3 那种"广播不落库"的旁路。
6. **前端渲染**：这才是"在渲染端做 JSON 流式适配"真正该落地的地方——但适配对象不是原始半截 JSON，而是后端已经推送过来的、结构化的、通过校验的 `item_progress` 事件。前端按 `phase + modelId` 分组，收到一条就 append 一张 claim/review/vote 卡片，不需要自己做任何 JSON 解析或容错。这比"前端自己用容错 JSON 解析器兜底半成品文本"简单得多，也更符合项目一贯的分工——校验永远在后端完成一次，前端只管展示。

**工作量**：中。新增一个几十行的小状态机 + provider 的流式接口（和 2.3 共享）+ 一个新 `RunEventType` + `orchestrator/index.ts` 的 `structuredCall` 内部改造。不改动任何 `@mmd/protocol` 的 schema——完全复用现有的 `ClaimSchema` 等子 schema。

### 2.3 Token 级流式（仅限 compose / section-compose 的自由文本）

**为什么这里不用 2.2 的"数组元素提取"方案**：`FinalAnswerSchema`/`SectionAnswerSchema` 的核心内容 `final_answer`/`section_answer` 是一段连续 prose，不是数组，没有"元素边界"可以增量提取——用户想看到的是这段文本本身逐字流式出现（打字机效果），不是某个数组条目一条条出现。`FinalAnswerSchema` 里虽然也有 `model_position_changes: PositionChange[]` 这样的数组字段，理论上可以复用 2.2 的机制，但这只是模型对已知信息（`positionChanges` 是编排层算好传给 prompt 的输入）的复述，用户价值远低于 `final_answer` 本身，第一版不必覆盖。如果启用了用户自定义 `userOutput`（见第 1 节），这份 JSON 应该在完整生成并通过 schema 校验后一次性展示，同样不建议做流式（没有稳定的 prose 字段可流）。

**路径**：
1. 给 `ModelProvider` 加一个**可选**方法（不是替换 `complete`，兼容 `MockProvider` 等不支持流式的实现，2.2 也复用同一个接口）：
   ```ts
   completeStream?(
     config: ModelConfig,
     request: CompletionRequest,
     onDelta: (delta: string) => void
   ): Promise<CompletionResult>;
   ```
   `OpenAICompatibleProvider` 实现时对 `/chat/completions` 传 `stream: true`，解析 SSE chunk，每收到一个 `delta.content` 就调用 `onDelta`，流结束后拼出完整文本，按现有 `parseUsage` 逻辑处理最后一个包含 `usage` 的 chunk（多数 OpenAI 兼容端点支持 `stream_options: {include_usage: true}`）。
2. `orchestrator/index.ts` 的 compose 调用处：如果 `provider.completeStream` 存在，就用它，`onDelta` 里 `emit` 一个新的 `RunEventType`（比如 `"token"`），数据 `{phase: "compose", delta}`；流结束后把拼好的文本走原来的 `callStructured` 校验路径（不变）。
3. **持久化要单独处理**：`token` 事件量级是"整个 compose 阶段的字符数"级别，不能像 phase 事件一样逐条走 `run-service.ts` 现有的 `eventChain` 串行持久化到 `run_events` 表（见"现状架构基线"最后一条）。建议 `token` 事件**只广播、不落库**——`Last-Event-ID` 断线重连不需要重放每一个 token，只需要重放最终的 `phase_completed`（已经包含完整文本）。可以在 `RunBroadcaster` 上加一个 `publishEphemeral(runId, event)`，跳过 `appendRunEvent`。
4. `apps/web` 订阅 SSE 时按事件类型分流：`token` 事件只在 compose 阶段渲染打字机效果，`item_progress` 事件（2.2）在 propose/critique/revise/vote/normalize 阶段渲染逐条卡片，其余仍然用 `phase_completed` 整段刷新兜底（万一 provider 不支持流式）。

**工作量**：中。涉及新的 provider 接口（与 2.2 共享）、SSE 事件类型、持久化旁路、前端订阅逻辑，但改动范围明确收窄在 compose/section-compose 两处调用点，不影响五个结构化 phase 的数据契约。

## 3. Tool calling（范围收窄为 propose + critique）

### 现状
**已完成（2026-07-09）**：`CompletionRequest.tools` 现支持最小的 `{type:"web_search"}` 内建工具面；直接 OpenAI BYOK provider 在请求启用该工具时改走 `/responses`，使用原生 `web_search`、`max_tool_calls: 1`、`store:false`，OpenRouter BYOK provider 继续走 Chat Completions 并发送官方 `openrouter:web_search` server tool（`max_total_results: 5`）。首版以一个全局开关同时覆盖 propose 和 critique，不跨模型缓存；为避免不同 provider 获得不对称能力，API 只接受全 OpenAI 或全 OpenRouter BYOK 的启用请求。OpenAI 每次原生搜索的 $0.01 固定费用被并入既有成本估算；OpenRouter 使用响应返回的真实 `usage.cost`。

### 重新评估：两个阶段的"独立性"担忧不一样，且都可管理
上一版分析笼统地担心工具调用会削弱"模型独立提案"这个协议前提。把 propose 和 critique 分开看，结论不一样：
- **critique 阶段本来就设计成能看到其他模型的 claims**（`buildCritiquePrompt` 的入参本身就是全部 `proposals`），"独立性"这个约束从一开始就只针对 propose，不针对 critique。允许模型在 critique 阶段用工具核实被评议的 claim 是否符合事实，不会引入任何新的协议违规——这其实是比 propose 风险更低的场景。
- **propose 阶段"独立性"约束的准确含义是"模型之间互相隔离"（不看到彼此的答案），不是"不能访问外部世界"**（`docs/protocol.md` 里这条约束原本针对的是跨模型信息泄露，不是外部工具访问）。所以允许模型在 propose 阶段查一次资料，并不直接违反现有协议文字。唯一值得留意的是产品层面的取舍：如果多个模型都调用同一工具查同一个问题，可能拿到高度相似的外部信息，从而降低"独立提案"带来的观点多样性——这不是架构阻碍，而是需要接受或缓解（比如给不同模型返回搜索结果的不同排序/摘要）的产品选择。

结论：两个阶段都可以做，且不构成对现有协议硬性规则的违反，真正要权衡的是同质化和成本，不是"能不能做"。

### 架构层面的实施路径（两阶段共用同一套机制）
沿用"单轮、内嵌在一次 `complete()` 调用里"的设计，propose 和 critique 完全复用同一套改动，不需要为两个阶段分别设计：
1. `CompletionRequest` 加 `tools?: ToolDefinition[]`（`{name, description, parameters: JSONSchema}`），`CompletionResult` 加 `toolCalls?: {name, arguments}[]`（主要用于调试/审计展示，不参与后续阶段的输入）。
2. `OpenAICompatibleProvider` 请求体透传 `tools`；响应里如果出现 `tool_calls`，**在同一次 `complete()` 内部**执行工具（第一版建议只内置一个 `web_search`）、把结果作为新的一条 `tool` role 消息追加、再发一次请求拿最终结构化答案——对 orchestrator 而言仍然是"一次 `complete()` 调用得到最终文本"，不改变 `fanOutWithQuorum` 的假设，只是 provider 内部多了一到两次网络往返（相当于把"最多一轮工具调用"内嵌进单次调用里，而不是暴露成外部可见的多轮状态机）。
3. **两次往返的 usage 要在 provider 内部合并成一个 `CompletionUsage`**（`promptTokens`/`completionTokens`/`costUsd` 分别相加），否则 orchestrator 的成本累加只会看到最后一次往返，低估真实花费，破坏 M5.1 成本熔断的准确性。
4. **工具执行失败要在 provider 内部兜底**（比如 `web_search` 依赖的第三方 API 超时/报错），把错误信息作为 `tool` role 消息内容喂回模型，让模型在没有工具结果的情况下继续完成本轮任务，而不是让整个 `complete()` 调用失败——这和项目里"单模型失败不拖垮整个 phase"的降级哲学一致，只是下沉到了单次调用内部。
5. **两个阶段各自在 prompt 里声明工具可用性**：`buildProposePrompt`/`buildCritiquePrompt` 都需要按 `request.tools` 是否非空决定要不要加一句"如需核实事实性信息可以调用 web_search"，避免没启用工具时 prompt 里出现无意义的说明。
6. **不覆盖 revise/normalize/vote/compose**：revise 是"针对已经收到的评议调整立场"，不涉及一手事实核查；normalize/vote 是综合归纳/表决；compose 刻意不设计成"裁判模型"（见 `docs/protocol.md`"没有终审模型"的设计原则）——如果 compose 也能查资料核实，会让它在事实核查上拥有比其他模型更大的权力，偏离这个设计初衷。这四个阶段保持不变。

### budget 的调整
`budget.ts` 的 `targetP95Ms` 是按"一次 LLM 请求"标定的；propose/critique 一旦启用工具，单次调用的实际延迟会多出一次工具往返，需要单独的预算余量，而不是全局改 `timeoutMs` 影响所有 run：
```ts
// budget.ts 新增字段，仅当该 run 显式启用了 tools 时对 propose/critique 生效
toolRoundTripAllowanceMs?: number; // 建议默认 15000-20000ms，具体看内置工具的真实延迟
```
`orchestrator/index.ts` 构造 propose/critique 的 `fanout.timeoutMs` 时，如果这次 run 启用了 tools，就在原有 `budget.targetP95Ms` 基础上加这个余量；未启用 tools 的 run 不受影响。

### 工作量与风险
中大（比只做 propose 的原方案略大，但两阶段机制完全复用，边际成本不高）。风险点已经从"是否违反协议"转移到：
- 多个模型调用同一工具产生同质化结果，削弱 propose 阶段本应有的观点多样性；
- `web_search` 这类工具本身的可靠性/合规性（返回内容的真实性、版权、速率限制）；
- 两次往返带来的延迟和成本，需要在 UI 上让用户清楚知道启用工具后单个 run 会更贵更慢，并纳入 M5.1 成本上限的展示。

建议把 tool 做成**运行时可选开关**（和 `costLimitUsd` 一样的心智模型），默认关闭，用户发起 run 时显式启用，而不是默认对所有 propose/critique 调用打开。

## 4. 多模态输入

### 现状
`CompletionRequest.userPrompt` 是纯字符串，`OpenAICompatibleProvider` 组装消息时 `content: request.userPrompt`（[openai-compatible.ts:82-86](../packages/model-adapters/src/providers/openai-compatible.ts)）。六阶段协议里除了 propose 阶段接收原始问题外，critique/revise/normalize/vote/compose 全部消费的是前面阶段产出的纯文本 claim——这意味着多模态输入的影响面可以收窄在"问题本身"这一个入口，不需要往后续 phase 扩散。

### 实施路径
1. **`model-adapters` 层**：把 `CompletionRequest.userPrompt` 的类型从 `string` 扩展为 `string | ContentPart[]`：
   ```ts
   export type ContentPart =
     | { type: "text"; text: string }
     | { type: "image_url"; imageUrl: string };
   ```
   `OpenAICompatibleProvider` 组装消息时按 OpenAI 的 content-parts 格式转换（`content: [{type:"text",...},{type:"image_url",...}]`）。
2. **`apps/api` 层**：新增图片上传的接收方式。两个选项：
   - 内联 base64：最省事，但会让 `runs`/`run_events` 表变胖，且受 Postgres 单行/JSON 字段大小限制影响。
   - 对象存储（如 S3 兼容服务）+ 传 URL：更干净，但需要新增存储依赖，超出当前"无 Redis、单机 Postgres 即可"的 M2 设计取舍（见 `docs/protocol.en.md`"no Redis"备注的同类精神）。
   - 建议先做内联 base64（够用且不引入新基础设施），等真的遇到体积问题再迁移到对象存储。
3. **`apps/web` 层**：问题输入框加文件/图片选择器，提交时把图片转 base64 塞进 run 创建请求。
4. **协议层**：`packages/protocol` 目前没有 schema 描述"问题输入"本身（`question: string` 是在 API 路由层的裸字符串，见 `routes/runs.ts`），所以这里的改动是加一个新的输入类型，而不是改动六个 phase 的 zod schema——`Proposal`/`Critique` 等 schema 保持纯文本不变。

**M6.5 已落地（2026-07-09）**：首版确定为 JPEG/PNG/WebP 的内联 base64 data URL，最多 3 张、单张 5MB、总计 12MB；原始图片存入 `runs.input_images`，不会由结果、SSE 或公开分享接口返回，并随 workspace 的 30 天级联清理删除。图片只随 propose 的 OpenAI-compatible content parts 发送，其他阶段和 planning outline 保持文本输入；不支持视觉的模型由既有 quorum 机制降级处理。

### 工作量与风险
中到中大，横跨 provider、API 路由、Web UI、可能还有存储选型，但不会波及五个纯文本 phase 的 schema，实际爆炸半径比"多模态"听起来的范围要小。

## 5. 建议实施顺序

这个顺序即 [roadmap.md](roadmap.md) 里 M6 的子项编号（M6.1–M6.6），顺序即优先级：

1. **（M6.1）用户自定义 JSON output**——先把产品语义钉准：保留内部 `FinalAnswer`/`PlanDocument`，新增最终 `userOutput` 格式化层；provider 原生 JSON mode 只是后续可靠性增强。
2. **（M6.2）per-model 细粒度进度事件**——小，`fanOutWithQuorum` 加一个可选回调即可，UX 收益明显。
3. **（M6.3）claim/item 级别渐进式解析**——中，新增一个通用的增量数组提取状态机 + provider 流式接口，覆盖 propose/critique/revise/vote/normalize 五个结构化阶段，复用各阶段已有的子 schema 做校验，不改协议。这一步和第 4 步共享同一个 `completeStream` provider 接口，建议一起设计接口、分两次落地。
4. **（M6.4）compose 阶段 token 级流式**——中，只做用户直接阅读的最终答案，注意 token 事件要走"广播不落库"的旁路，避免 `run_events` 写放大。
5. **（M6.5）多模态输入**——中大，仅影响 propose 入口，五个后续 phase 的 schema 不用动。
6. **（M6.6）Tool calling（propose + critique）**——中大，两阶段共用同一套单轮工具机制；风险点是同质化和成本而不是协议冲突，建议做成运行时可选开关、默认关闭。

## 6. 待决问题（需要产品/协议层面拍板，不只是工程实现）

- 用户自定义 JSON output 第一版只支持 JSON Schema，还是也支持"给一个 JSON 示例/模板然后系统推断 schema"？后者更易用，但推断规则需要非常明确，否则会让用户以为示例里的值也是内容约束。
- `userOutput` 是作为 `GET /result` 的附加字段展示，还是要支持一个只返回 `userOutput` 的轻量 endpoint（便于自动化调用方直接消费）？
- claim/item 级别的 `item_progress` 事件，前端在同一 phase 收到新的 `attempt`（repair 重试）时是直接清空重画，还是要保留上一次尝试的草稿做对比展示？建议第一版直接清空，简单且不会误导用户把草稿当最终结果。
- Token 级流式是否要对 planning 模式的 section-compose 同步做（多个 topic 并行流式意味着前端要同时渲染多路打字机效果，UI 复杂度会上升）？
- ~~Tool calling 的 `web_search` 结果要不要在同一个 run 内跨模型共享/缓存一份？~~ 已确认：不共享，以保留模型独立性。
- ~~propose 和 critique 的工具开关是做成一个开关还是两个独立开关？~~ 已确认：使用单一 `webSearch` 开关，两个阶段同开同关。
- ~~多模态输入的图片是否需要长期保留（影响存储选型）还是只在 run 生命周期内使用？~~ 已确认：内联 base64 存入 run，随匿名 workspace 的 30 天清理一起过期。
