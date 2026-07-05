# Deliberation Protocol v0.1

*[English](protocol.en.md)*

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

每个 outline topic 独立跑一次完整的 propose→critique→revise→normalize→vote→classify（`packages/orchestrator/src/index.ts` 的 `runTopicDeliberation`——M2 阶段从 `apps/cli` 提取为共享包，CLI 和 `apps/api` 都从这里 import，逻辑本身未变），所有主题**并行**执行（`Promise.all`/`Promise.allSettled`，不串行——避免延迟随主题数线性增长）。这意味着：

- `classifyCandidate`、`checkQuorum`、`fanOutWithQuorum` 等核心函数完全不需要知道 topic 的存在，按主题分别调用即可，不做任何改动。
- Claim/candidate id 在 `stampProposal` 里扩展成 `${topicId}::${modelId}::c${i}`（原本是 `${modelId}::c${i}`），保证跨主题不冲突，同时不touch `src/ids.ts`（那个模块解决的是跨 run 的存储键隔离，是另一个维度）。
- 单个主题的 quorum 失败会让该主题的 `runTopicDeliberation` 抛出 `DeliberationQuorumError`，但 `runPlanningDeliberation` 用 `Promise.allSettled` 收集结果——一个主题失败不会拖垮整个规划文档（同一个"单模型失败不阻塞整个 run"的原则，往上提了一层），除非**全部**主题都失败才会整体报错。

### Section Compose：为什么 executive summary 是确定性拼接，不是模型调用

每个主题单独跑一次 section-compose（`buildSectionComposePrompt` / `SectionAnswerSchema`，字段等价于 `FinalAnswerSchema` 加上 `topic_id`/`title`/`tldr`）。最终文档的 `executive_summary` 是**用代码把每个 section 的 `tldr` 拼起来**，不再调一次模型做"跨主题综合摘要"——如果加这一次调用，等于让 compose 重新变成跨主题做判断的裁判，正是 4.1/4.3 原则一直在避免的失败模式。`FinalAnswerSchema` 本身完全不变，`SectionAnswerSchema` 是独立的新 schema，不是把 `FinalAnswerSchema` 改成一个"可能有 topic 也可能没有"的联合类型。

### 预算与 CLI

`getBudget("planning")` 返回 `PLANNING_BUDGET`：每个主题跑完整六阶段（`phases` 与 `STANDARD_BUDGET` 相同），外加 `maxTopics: 8`。CLI 用 `--mode planning` 触发。

### 真实耗时基线（截至本文档更新时）

用真实模型（Volcengine/DeepSeek 系列推理模型）跑过的窄问题（standard 模式）单次耗时在 96-250 秒之间，远高于 `STANDARD_BUDGET` 里当初凭 mock 猜测的 p50 60s / p95 120s 目标——这两个数字还没有用真实数据校准，是已知的后续待办，不在这次 v0.2 改动范围内。Planning 模式因为每个主题都要跑完整六阶段，单个主题的耗时预期和 standard 模式的单次 run 类似，多个主题并行执行，所以总耗时约等于"最慢的那个主题"而不是"耗时总和"。

换成真正跨厂商的组合（OpenAI GPT-5.5 / DeepSeek v4 Pro / Google Gemini 3.1 Pro，经 OpenRouter 统一接入）后，单次 standard 模式耗时在 164-301 秒之间，量级和之前同厂商组合接近，没有明显变慢或变快。

### 已观察到的一个分类边界情况：全票 critical 反对会进入 disputed 而不是 rejected

`classifyCandidate` 的规则是"存在 critical 反对就直接进 disputed，不能被多数票吞掉"（见上文"共识分类是比例制"一节）。真实测试中出现过一次：normalize 阶段产生了一条空白/无实质内容的 candidate claim，三个模型在 vote 阶段**全部**投了 `object`（major/critical/critical）。按现有规则，这会被分类为 `disputed`，而不是更符合直觉的 `rejected`——因为"critical 反对"的判断只看是否存在，不看是否全票一致。这不是 bug（规则本身是为了防止多数票压制少数关键异议，这里只是恰好三票都反对），但值得记录：如果未来发现"全票反对却显示为 disputed"造成用户困惑，可以考虑加一条特化规则——全体投票都是 `object`（无论 severity）时直接归为 `rejected`，视为独立于比例阈值的显式一致排除。

### 一个真实的 disputed 案例（planning 模式，跨厂商组合）

用跨厂商组合跑"给 3 人团队的电商项目做技术选型规划"（planning 模式）时，"后端技术栈与接口设计"这个主题下出现过一次真实分歧：候选方案"Java 21 + Spring Boot 3"进入 strong_consensus，候选方案"TypeScript + Node.js + NestJS"被分类为 `disputed`——两个模型投了 approve，但提出该方案的模型自己在投票阶段投了 `object`（major），理由是"把两个方案并列作为等价选项具有误导性，电商项目的状态机/事务/库存并发等复杂逻辑在 Node 生态里处理成本明显更高"。这验证了比例制共识 + major 反对规则在真实的、有实质技术论据的分歧场景下能正确工作（2/3 approve 但有 major 反对，没有被多数票压过去，正确分流到 disputed 而不是 strong_consensus）。

同一次复测也发现并修复了一个 bug：section-compose 阶段的模型会给 `topic_id` 编一个更语义化的新字符串（例如把 outline 给的 `"4"` 改写成 `"backend-tech-stack-api-design"`），而不是照抄传入的原始值——和 propose/critique/revise/vote 阶段模型瞎编 `model_id`/`claim_id` 是同一类问题。`packages/orchestrator/src/index.ts` 的 `stampSectionAnswer` 现在会用调用时已知的 `topic.topic_id`/`topic.title` 覆盖模型自报的值，`packages/model-adapters` 的 `MockProvider` 也相应改成故意模拟这种"改写 id"的行为，让回归测试能真正测到这个修复（否则 mock 会一直老实回填，永远测不出这类问题——这是这个项目里第二次踩到"mock 太听话导致测试有盲区"的坑）。

## M2：Backend API

M2 把 `apps/cli` 里已经验证过的 orchestrator 逻辑（现已提取为 `packages/orchestrator`，CLI 和 `apps/api` 共用同一份实现）搬到了 Fastify + Postgres 服务端，协议本身（六阶段 schema、比例制共识、quorum、budget）完全不变——M2 是纯粹的交付层工作，不是协议修订。

- **Conversation/Run API**：`POST /api/conversations`、`POST /api/conversations/:id/runs`、`GET /api/runs/:id`、`GET /api/runs/:id/result`。
- **SSE 事件流**（`GET /api/runs/:id/events`）：`packages/orchestrator` 的 `onEvent` 回调本来就已经在每个阶段边界触发（`run_started`/`phase_started`/`phase_completed`/`run_failed`/`run_completed`，含 planning 模式的按主题事件）——M2 只是把这些事件持久化到 `run_events` 表（按 run 内单调递增的 `seq` 排序）并通过一个进程内的内存广播器转发给当前连接的 SSE 客户端。断线重连时客户端带上 `Last-Event-ID`，服务端先从 Postgres 回放 `seq` 更大的历史事件，再继续实时推送。
- **与原技术设计文档的一处偏离：模型选择改为服务端注册表，而不是客户端自带 provider**。原文档的 API 草案里，创建 run 的请求体直接让客户端传 `{id, provider}` 这样的模型对象；M2 改成服务端加载一份 `models.config.json`（与 `apps/cli` 同构：`id`/`modelId`/`baseUrl`/`apiKeyEnvVar`），创建 run 的请求只能从这份服务端注册表里选 `modelIds` 子集。原因：避免客户端自带任意 `baseUrl` 造成 SSRF，也避免需要客户端自己提供 API key。没有 `models.config.json` 时和 CLI 一样退回 `MockProvider`。
- **不引入 Redis**：原技术设计文档提到用 Redis 做任务状态/短期事件队列，但 M2 的验收标准（能发起 run、能实时订阅、刷新后能看到结果）不需要跨进程的事件分发——单进程内存广播器 + Postgres 持久化（用于断线重连回放）已经足够。等真正需要水平扩展时再引入，不在这个阶段过度设计。
- **持久化**：`conversations`/`runs`/`run_events` 之外，`claims`/`reviews`/`candidates`/`votes` 表把每个 run 的详细数据落成可查询的行（`candidates.source_claim_ids` 保留 M0 的可追溯性约束），`run_results` 表则存一份完整的 `DeliberationResult`/`PlanDocument` 快照作为 `GET /result` 的直接数据源。表结构和迁移脚本见 `apps/api/src/db/migrations/0001_init.sql`。

## M4 第一阶段：BYOK 重新打开"客户端自带 provider"，但保留白名单

上一节提到 M2 为了避免 SSRF、避免需要客户端自带 key，把模型选择收敛成了服务端 `models.config.json` 注册表。M4 第一阶段（不做账号体系，BYOK 平台，详见 multi-model-deliberation-dev-roadmap.md）重新允许客户端提供自己的 API key，但没有重新打开"客户端自带任意 baseUrl"这个口子：

- `packages/protocol/src/provider-whitelist.ts` 定义一份固定的 provider 列表（`providerId` → 固定 `baseUrl`），目前只有 OpenAI 兼容格式的 OpenAI/DeepSeek/OpenRouter/Volcengine。客户端只能选 `providerId` + 自己的 `apiKey` + 自由文本的 `modelId`，永远不能自己传 `baseUrl`——这就是为什么重新允许客户端自带 key 之后，SSRF 面并没有重新打开：`baseUrl` 依然完全由服务端按 `providerId` 查表决定。
- `apps/api/src/config/provider-factory.ts` 的 `buildRunProvider()` 按每次 `POST /runs` 请求构造 provider（把选中的服务端注册表模型 + 客户端自带的 BYOK 模型合并成一个 `RoutingProvider`），跟 `buildProvider()`（启动时构造一次，服务于服务端注册表）完全分开，互不影响。
- 完全自定义 baseUrl（用户自建/小众服务）需要额外一整套 SSRF 加固（内网地址过滤、DNS rebinding 防护、重定向校验、IP 编码解析），评估后判断工作量明显更大，作为明确的后续待办，这次没有做。

## M5.1：成本熔断

BYOK 平台让陌生人用自己的 key 跑 run，失控调用（尤其 planning 模式最多 8 个主题、每个主题完整跑六阶段）可能在用户不知情的情况下烧穿账号额度。M5.1 在 orchestrator 层加了一个跨阶段累加的成本计数器 + 熔断检查，不是每个 provider 各自实现一遍。

- **`packages/model-adapters` 的 `CompletionResult` 新增可选 `usage` 字段**（`promptTokens`/`completionTokens`/`totalTokens`/`costUsd`/`raw`）。`OpenAICompatibleProvider` 从响应体解析 `usage`，`MockProvider` 也强制返回一个确定性的假 usage（默认 `costUsd: 0.0001`，可通过 `costPerCallUsd` 覆盖）——这个项目已经三次踩过"mock 太听话，真实数据路径才暴露 bug"的坑（`stampProposal`/`stampSectionAnswer`/candidate id 前缀三个案例，见 dev-roadmap.md 的 M1/v0.2/M2 补充），这次提前用同样的纪律防一次，而不是等真实调用暴露。
- **`packages/protocol/src/pricing.ts`：按 `providerId` 分派的计价策略，不是一张统一定价表**：
  - `openrouter`：不查表，直接读响应里的 `usage.cost`（或 `cost_details.upstream_inference_cost`）——OpenRouter 报的是真实扣费金额，比自己算的估算更准，标记为 `precision: "exact"`。
  - `deepseek`：按 `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`/`completion_tokens` 三档分别计价（cache hit 和 cache miss 单价相差数倍，按 `prompt_tokens` 总数算会明显偏差），tier（standard vs reasoner）从 modelId 字符串猜测，标记为 `"approximate"`。
  - `openai`/`volcengine`：单一 blended $/1M-token 汇率（不是逐 SKU 定价表——新模型上线的速度比手工维护的表快），同样标记为 `"approximate"`。
  - 认不出的 provider/model：`costUsd: undefined`，标记为 `"unknown"`——不阻断 run，也绝不编造一个数字去参与熔断判断。
- **实际汇率数字单独放进 `packages/protocol/src/pricing-rates.ts`，跟计价逻辑分开**：每条汇率带 `sourceUrl`/`asOf`/`confidence` 字段，刷新一个过时的数字应该是"改一行数据"，不是"改计价逻辑代码"。这个拆分不是预先设计好的，是被用户指出"数字要查最新的、不要硬编码"之后现改的——第一版直接把汇率写死在 `pricing.ts` 的计算函数旁边，且部分数字是从 AI 搜索摘要（转述第三方聚合站点）里抄来的，没有直接核对官方文档，属于典型的"看起来合理但没验证"。
- **核实后发现两个数字是错的，已修正（2026-07-04，直接抓取官方文档原文，不是搜索摘要）**：
  - **DeepSeek**：原来写的是 cache hit $0.0028/1M、cache miss $0.14/1M（第三方聚合站点转述），直接抓取 `api-docs.deepseek.com/quick_start/pricing-details-usd/` 后发现真实数字是 `deepseek-chat` cache hit $0.07/1M、cache miss $0.27/1M、output $1.10/1M——cache hit 单价差了约 25 倍。
  - **OpenAI**：原来用的是 GPT-4.1 的 $2/$8（每 1M token），直接抓取 `developers.openai.com/api/docs/pricing` 后发现 GPT-4.1 在当前定价页里已经不存在了（已被 gpt-5.x 系列取代），改用当前主力档位 gpt-5.4 的 $2.5/$15。
  - **Volcengine**：官方文档页是 JS 渲染，直接抓取拿不到正文内容，多个第三方来源之间的数字也互相矛盾（$0.47/$2.37 vs $0.67/$3.36，以及更新的 Doubao 2.1 系列 ¥6/¥30）；最终用了多个独立来源都提到的 ¥6/¥30（按约 7.15 的近似汇率换算成 $0.84/$4.20），并在 `pricing-rates.ts` 里显式标注 `confidence: "low-confidence-secondary-sources"`，是四个 provider 里置信度最低的一个。
- **`packages/orchestrator`**：`DeliberationInput.costLimitUsd?: number`，每个阶段开始前（不是阶段进行中——已经在飞的调用总会跑完，跟现有 quorum 的"优雅、有界、非瞬时"降级风格一致）检查累加成本是否已超阈值，超过则标记 run 为 `failed`（复用现有 `run_failed` SSE 事件 + `DeliberationQuorumError` 同款的 "throw 一个类型化 Error，run-service.ts 原有的 catch 逻辑直接生效" 路径，没有改 `apps/api` 的失败处理代码）。Planning 模式的并行 topic 共享同一个 `CostState` 实例（按引用传递），任一 topic 触发熔断后，其余 topic 的下一个阶段检查点也会立刻观察到同一个共享状态并跟着停止——不能取消已经在飞的网络请求，但能保证"最多再多花一轮在飞调用的钱"。
- **顺带修的一个既有 bug**：planning 模式如果所有 topic 都失败，`runPlanningDeliberation` 原本直接 `throw`，从未 `emit("run_failed", ...)`，导致 SSE 连接永久挂起（这个缺口本来就记在 M3 补充一节里）。M5.1 让"所有 topic 因同一个共享成本阈值被熔断"变成了一个会真实发生的场景（不再只是罕见的多模型同时宕机边缘情况），顺带修掉了这个缺口。
- **默认成本上限**：`apps/api` 的 `POST /runs` 路由定义 `DEFAULT_COST_LIMIT_USD = 5`，客户端不传 `costLimitUsd` 时用这个值兜底（不是"不传就不设防"）——具体数字是跟用户确认过的，不是凭空定的。`GET /runs/:id/result` 通过 `run_results` 表新增的 `cost` 列（迁移 `0004_run_results_cost.sql`）暴露 `{totalUsd, limitUsd, hasUnknownPricing}`。
- **真实验证（2026-07-04，浏览器 + 本地 Postgres，MockProvider）**：quick 模式一次正常 run 完成后正确显示 "Cost so far: $0.0004"，`psql` 直接查库确认 `run_results.cost` 落库正确；standard 模式故意设一个极低的 `costLimitUsd` 后，run 在 propose 完成、critique 开始前被正确熔断为 `failed`，前端复用既有的 `ErrorPanel` 正确展示 "cost limit exceeded before "critique": ..."，SSE/服务端日志均无异常。`packages/protocol/test/pricing.test.ts` 的断言直接从 `pricing-rates.ts` 的导出常量算期望值，而不是把数字复制粘贴进测试——这样以后刷新汇率时测试不用跟着改。**未做的验证**：这次没有打真实 OpenRouter/DeepSeek 请求核对 `usage.cost` 的量级是否与官方账单一致（沙盒里没有可用的真实 BYOK key）；Volcengine 的汇率本身就是低置信度的次级来源估算，需要真实调用或能访问 JS 渲染页面的工具才能核实。

### M5.1 follow-up：BYOK 用户自填计价（不能实时抓取，就让用户自己填）

内置的 `pricing-rates.ts` 表终究只是一个静态快照，会随时间漂移（上面那次核实已经证明了这一点）。用户指出"既然没法每次都抓最新数据，不如让用户自己填"之后，加了一条独立于内置表的计价路径：

- **`calculateCostUsd` 新增 `userRate` 参数，优先级：provider 真实回传成本 > `userRate` > 内置近似表 > unknown**。`userRate` 不挂在某个特定 provider 分支下，而是在 dispatch 最前面统一处理——这意味着一个完全不在白名单里的 provider，只要用户填了 `userRate`，也能被计价（内置表本来就不可能覆盖任意 provider，`userRate` 是唯一的兜底）。`PricingPrecision` 新增第四态 `"user-provided"`，跟 `"approximate"` 区分开，因为置信度来源不同（一个是我们猜的，一个是用户自己说的）。
- **`OpenAICompatibleProvider` 新增 `pricing` 构造选项**，透传给 `calculateCostUsd` 的 `userRate` 参数——`apps/api` 的 BYOK 路径（`buildRunProvider`）按每次请求构造这个 provider 实例时把 `pricing` 传进去。
- **随 BYOK key 一起持久化**：`workspace_api_keys` 表新增 `input_per_million`/`output_per_million`（迁移 `0005_workspace_api_keys_pricing.sql`，用 `double precision` 而不是 `numeric`——后者 node-postgres 默认按字符串返回，会悄悄违反 TS 里 `number | null` 的类型声明）。请求级别的 `pricing` 覆盖优先于已保存 key 的持久化汇率（`m.pricing ?? saved.pricing`），且只影响这一次 run，不会顺带改掉存储的值——要更新存储的值，需要重新勾选"记住"再提交一次（跟 key/label 本身的 upsert 语义一致）。
- **前端建议值来自服务端，不是打包进前端的运行时依赖**：`apps/web` 此前所有对 `@mmd/protocol` 的引用都是 `import type`（编译期擦除，从不进入 Turbopack 的打包图）。给 `ByokModelForm` 加"建议汇率"预填功能时，第一版直接 `import { OPENAI_RATE, ... } from "@mmd/protocol"`（真实值导入），结果 `next build` 报 "Module not found: Can't resolve './budget.js'"——`packages/protocol` 的 package.json `"main"` 直接指向 `./src/index.ts`（未编译的 TS 源码），且内部用 `.js` 后缀导入 `.ts` 文件（Node ESM 的标准写法，`tsc`/`tsx`/`vitest` 都认得），但 Turbopack 打包一个来自 `node_modules` 符号链接的原始 TS 包时，不会做"`.js` 后缀映射回 `.ts` 文件"这一层解析，即使加了 `transpilePackages` 也一样（`transpilePackages` 只解决"要不要转译"，不解决这个扩展名映射问题）。修复：不让前端直接 import 计价包，而是把"建议汇率"这一份数据挪到服务端计算（`suggestedRateFor` 加进 `packages/protocol/src/pricing.ts`，`GET /api/providers` 响应里每个 provider 附带 `suggestedRate` 字段），前端照常用 `fetch` 拿——这跟 `/api/models`、`/api/providers` 一贯的"前端只拿数据，不拿运行时逻辑"的架构完全一致，比跟 Turbopack 的模块解析较劲更省事，也更符合这个项目一贯"能不加基础设施就不加"的风格。
- **真实验证（2026-07-04，浏览器 + 本地 Postgres）**：选 provider 下拉框时，输入/输出价格框正确按 provider 切换建议值（OpenAI → 2.5/15，DeepSeek → 切到 cache-miss 档 0.27/1.1，OpenRouter → 清空，因为它没有建议值可给）；手动改成 1.23/4.56、勾选"记住"、提交一次 standard 模式 run 后，`psql` 直接查 `workspace_api_keys` 表确认 `input_per_million=1.23`/`output_per_million=4.56` 落库正确；刷新到新会话后 `SavedKeysPicker` 正确显示 "openai:gpt-4.1-mini ($1.23/$4.56 per 1M tokens)"。全 workspace 8 个包 `npm run build`/`npm run test` 均通过，214 个测试零回归。

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
