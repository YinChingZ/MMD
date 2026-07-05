# 多模型协商式对话产品：改进版开发流程

日期：2026-07-03（最后更新 2026-07-05，M5.3 完成）
配套文档：[multi-model-deliberation-tech-design.md](/Users/xyz91928/Documents/Codex/2026-07-03/yo/outputs/multi-model-deliberation-tech-design.md)、[docs/protocol.md](docs/protocol.md)

## 当前进度

| 阶段 | 状态 | 说明 |
|------|------|------|
| M0 协议加固 | ✅ 完成 | `packages/protocol`，五个风险点全部落地为 schema/纯函数约束 |
| M1 CLI 原型 | ✅ 完成 | `apps/cli`，mock provider 和真实 OpenAI 兼容 API 都跑通过 |
| M1.5 收敛验证关卡 | ✅ 完成，Go 决策 | 见下方"M1.5 实际结果" |
| v0.2 Planning Mode（长输出支持） | ✅ 完成 | 不在原路线图里，M1.5 之后新增，见下方专门一节 |
| M2 Backend API | ✅ 完成 | 见下方"M2 补充：Backend API — 实际结果" |
| M3 Web MVP | ✅ 完成 | 见下方"M3 补充：Web MVP — 实际结果" |
| M4：BYOK 平台 | ✅ 完成，M4 到此结束 | 见下方"M4 第一阶段补充：BYOK — 实际结果"；不做账号体系，用户自带 API key；原计划的成本估算/熔断、分享链接不再算作 M4，移入 M5 |
| M5：项目收尾与生产就绪 | 进行中（M5.1、M5.2、M5.3 完成） | 见下方"M5"一节；按优先级：成本熔断→CI→限流/清理→部署→分享链接。M5.1 成本熔断、M5.2 CI、M5.3 限流与数据清理已完成；下一步 M5.4 部署文档/Dockerfile |

## 0. 为什么要改

原技术设计文档的协议设计（Propose → Critique → Revise → Normalize → Vote → Compose）和产品方向是扎实的，不需要推翻。但审阅后发现五个结构性风险：如果不在协议/schema 阶段就修正，会在写完 orchestrator 代码、跑通 CLI 甚至上线 backend 之后才暴露，届时修复成本高得多（涉及数据库迁移、协议破坏性变更、前端返工）。

| # | 风险 | 原文档现状 |
|---|------|-----------|
| 1 | 成本/延迟被低估 | 单次协商 ≈13-15 次串行模型调用，"quick mode" 只提了一句话，没有具体设计 |
| 2 | Normalize 阶段隐含裁判权 | coordinator model 合并 claims 的取舍会影响后续投票，与"主持人不判断真理"的原则有张力 |
| 3 | 共识分类规则写死了 3 模型 | "3/3 approve"、"2 approve + 1..." 这类硬编码计数，模型数一变就要重写 |
| 4 | 没有单模型失败/超时的降级策略 | orchestrator 伪代码假设所有模型都会成功返回 |
| 5 | claims 表主键未按 run 隔离 | `id text primary key` 用 `a_c1` 这种短 id，跨 run 会主键冲突 |

本文档的改法：新增一个 **M0（协议加固）** 里程碑，写在任何 orchestrator 代码之前；并在 M1 之后插入一个 **M1.5（收敛验证关卡）**，用真实数据决定"协商是否真的产生价值"这个最大的产品假设是否成立，再决定要不要投入 backend/web。

技术栈：**TypeScript/Node**（与原文档的 Next.js 前端、NestJS 方案一致，前后端同语言，schema 用 zod，可在 CLI 与未来 web/api 之间共享）。

## 1. 修订后的里程碑序列

### M0：协议加固（新增，预计 0.5-1 天，不写 orchestrator 代码）

目标：把五个风险点在协议/schema 层面钉死，后面的代码直接按这个协议写，不用返工。

- **共识分类改比例制**：把原文档"3/3 approve"、"2 approve + 1 approve_with_conditions" 这类计数规则，改写成比例阈值，例如：
  - `strong_consensus`: `approve_ratio >= 1.0`（全体 approve，允许 conditions）
  - `qualified_consensus`: `approve_ratio >= 0.66` 且无 critical object
  - `disputed`: 存在 critical/major object，或 approve_ratio 不足
  - `rejected`: `approve_ratio <= 0.33`

  这样模型数从 3 变成 4、5 都不需要改分类逻辑。

- **claim/candidate id 按 run 隔离**：id 格式定为 `${run_id}:${local_id}`（例如 `run_8f2a:a_c1`），或者数据库层面用复合主键 `(run_id, claim_id)`。在写 DDL 之前先定下来，避免上线后要做迁移。

- **模型失败/超时策略**：每个阶段定义最低响应法定人数（quorum），例如 3 模型场景下 quorum = 2。未达到 quorum 的阶段标记为 `partial`，该阶段涉及的候选内容在最终结果里显式提示"仅基于部分模型响应"，而不是让整个 run 直接失败。达到 quorum 但有模型缺席时，缺席模型的后续阶段跳过，不阻塞整体流程。

- **延迟/成本预算**：定义目标基线（3 模型、1 轮 critique）：
  - 目标 p50 总耗时 ≤ 60 秒，p95 ≤ 120 秒（具体数字待 M1 实测后校准）。
  - `quick mode` 具体定义：2 模型、跳过 critique/revise，只做 propose + 直接 compose（无表决）。作为独立协议路径而不是"少跑几轮"的模糊说法。

- **schema 单一定义源**：用 zod 把第 5 章六个阶段（Propose/Critique/Revise/Normalize/Vote/Compose）的 JSON 结构写成 `packages/protocol` 里的 schema 定义，导出类型和校验函数，CLI 和未来 backend 共用，避免 schema 漂移。

- **Normalize 阶段透明性兜底**：协议层面明确规定：
  - candidate claim 必须保留 `source_claim_ids`。
  - 任何展示最终结果的界面/输出，都必须能够追溯回合并前的原始 claims（不能只显示 candidate 文本）。
  这一条写成协议约束，而不是留到 UI 章节作为"建议"，防止实现时被简化掉。

**验收标准**：
- `packages/protocol` 下有六个阶段的 zod schema + 类型导出。
- 共识分类函数是纯函数，输入 votes + 比例阈值，输出分类结果，有单元测试覆盖 3/5/7 模型场景。
- 协议文档里写明 quorum、quick mode、透明性兜底三条规则。

### M1：CLI 原型（把韧性设计前移，不留到后面补）

在原文档 Milestone 1 基础上，把原本可能被跳过的健壮性能力直接内建：

- propose → critique → revise → normalize → vote → compose 全流程跑通。
- JSON 校验失败时自动重试/让模型修复，而不是直接报错。
- per-model 超时 + quorum 判定按 M0 定义的策略执行。
- 共识分类用 M0 的比例制函数。
- 输出结果里包含 normalize 前的原始 claims 追溯链（哪怕 CLI 阶段只是打印在 JSON 里，不做 UI）。

**验收标准**（在原文档基础上新增）：
- 一个问题可以完整跑完，可以看到每个模型是否修改立场。✅
- 最终答案按共识分类生成，且能从 candidate claim 追溯到原始 claim。✅
- 跑 5-10 个跨类型真实问题（事实类、主观判断类、技术权衡类），记录每阶段耗时和 token 成本，产出一份耗时/成本基线表。✅ 实测下来单次真实 run 耗时 96-410 秒不等（远超 M0 阶段凭空猜的 60s/120s 目标，见 `docs/protocol.md`"真实耗时基线"一节，`STANDARD_BUDGET` 的具体数字还没回填，是已知待办）。
- 至少构造 1 个"某模型超时/报错"的场景，验证 quorum 降级路径不会让整个 run 崩溃。✅ 真实场景下也验证过：某个模型两次超时，quorum 仍以 2/3 完成 run，没有崩溃。

**实测中额外发现并修复的问题**（M1 acceptance criteria 之外，属于真跑真实模型才会暴露的坑）：
- 真实模型会在 `model_id`/`claim_id` 字段里瞎编身份（甚至编出别的厂商的模型名），不会老实回填我们传给它的 id。`stampProposal`/`stampCritique`/`stampRevisionSet`/`stampVoteSet` 现在强制用调用时已知的 `ModelConfig.id` 覆盖模型自报的身份，claim id 按模型加前缀隔离，避免跨模型的 id 碰撞。mock provider 测试完全测不出这个问题，因为它一直老实回填。

### M1.5：收敛验证关卡 — 实际结果（已完成，Go 决策）

用真实模型（Volcengine/DeepSeek 系列推理模型）跑了 4 个真实问题（事实类、主观判断类、技术权衡类、刻意挑的争议话题）：

- **critique/revise 是真实工作，不是走过场**：多次观察到具体的事实修正（比如金球奖数量从 7 次修正为 8 次）和表述精细化（比如区分"简单 BFF"和"复杂 BFF 场景"），都能追溯到具体的同行评审意见。
- **没有分歧时不会硬造分歧**：事实类问题（地月距离）三个模型直接一致，revise 阶段全是 `keep`。
- **disputed/rejected 分类最初没有被真正触发过**：跑过的所有真实问题（含刻意选的"996 工作制是否应该被禁止"这种有争议话题）最终都收敛到 strong/qualified consensus，vote 阶段几乎没有 `object` 票。当时的原因判断：3 个模型（deepseek 系 + glm）同属一个供应商生态，观点相关性偏高。
- **换成真正跨厂商组合后的复测（2026-07-04）**：把三个模型换成 OpenAI GPT-5.5 / DeepSeek v4 Pro / Google Gemini 3.1 Pro（经 OpenRouter 统一接入），重跑了梅西 vs C罗和 996 这两个问题：
  - `object` 票确实出现了（之前同厂商组合从未出现过），但两次都是三个模型**一致**投票否决一条空白/无实质内容的候选声明，不是模型之间的真实分歧。
  - 对两个话题本身的实质内容，三个不同厂商的模型**依然**收敛到几乎一致的结论（梅西 vs C罗：分维度承认互有优势；996：长期弊大于利）。
  - **修正后的判断**：最初"同厂商导致虚假收敛"的假设不完全成立——换成真正独立的模型组合后，disputed 路径依然没有被这两个具体话题触发，更可能的原因是这类话题本身论据结构比较一边倒（996 debate 尤其受 2021 年后中国监管环境影响，可能各家模型的训练语料都反映了相近的主流叙事）。真正验证 disputed 路径，可能需要换一批本身在训练/立场上没有强共识锚点的话题，而不只是换模型组合。
  - 详见 [docs/protocol.md](docs/protocol.md)"已观察到的一个分类边界情况"一节：这次复测还发现一个分类边界情况——全票 critical 反对会被归类为 `disputed` 而不是更符合直觉的 `rejected`，是规则按预期生效，不是 bug，但标注为可能的后续优化点。
- **Go 决策**：核心产品假设（协商能产生真实增量价值）成立，进入 M2 backend 开发。协议本身不需要在这个阶段再调整。

这一步的意义是把"协商是否真的产生增量价值"这个最大的产品假设，放在投入 backend/web 资源之前验证，而不是等 Web MVP 做完才发现模型只是在互相客套——现在已经验证过，可以放心往下走。

## v0.2 补充：Planning Mode（长输出/综合技术规划支持）

M1.5 之后，讨论到"如果用户想让模型给一个项目做全面技术规划"这种长输出场景，发现 v0.1 协议有结构性缺口（claim 数量爆炸导致 critique 的 O(n²) 成本失控、跨主题的 claim 被硬塞进同一个合并/投票池、compose 输出扁平不适合结构化文档）。已实现并上线：

- 新增 **Outline 阶段**：单一 coordinator 调用把问题拆成最多 8 个主题，然后现有六阶段协议对每个主题**并行**独立跑一遍（详细设计和"为什么 outline 阶段可以用单一 coordinator 而不违反 4.1 原则"的推理见 [docs/protocol.md](docs/protocol.md) "v0.2 Planning Mode" 一节）。
- 最终文档按主题分节，`executive_summary` 是每个 section 的 `tldr` 确定性拼接，不是再调一次模型做跨主题摘要。
- v0.1 的所有行为完全不受影响（现有测试零回归），CLI 用 `--mode planning` 触发。
- **真实验证（同厂商模型组合，2026-07-04 早期）**：跑了一次"给 3 人团队的电商项目做技术选型规划"，outline 自动拆出 8 个合理的主题（后端/前端/数据库/部署/支付/搜索/缓存/认证安全），全部 quorum 3/3，并行执行总耗时 6 分 46 秒（如果串行会是 40+ 分钟）。critique/revise 产生了大量真实的实质性修正（如指出 Firebase Auth 在中国不可靠、补充云托管 Elasticsearch 折中方案等），但最终分类仍以 strong_consensus 为主，没有出现真实分歧。
- **换成跨厂商组合后复测（OpenAI GPT-5.5 / DeepSeek v4 Pro / Google Gemini 3.1 Pro）**：同一个问题重跑一次，8 个主题里"后端技术栈与接口设计"这个主题出现了**真实的技术分歧**：一个候选方案是 Java 21 + Spring Boot 3（strong_consensus），另一个候选方案是 TypeScript + Node.js + NestJS 被分类为 **disputed**——两个模型投了 approve，但提出该方案的模型自己在投票阶段投了 `object`（major），理由是"把 Node.js 方案和 Java 方案并列作为等价选项具有误导性，电商项目的状态机、事务、库存并发等复杂逻辑在 Node 生态里处理成本明显更高，不该作为无条件的二选一建议"。这是 2:1 但带 major 反对、被正确分类为 disputed（没有被多数票压过去）的真实案例。**"长内容里的具体技术决策更容易暴露真实分歧"这个猜想，在跨厂商组合下得到了验证**——跟宽泛的主观辩论（996、球星之争）不同，具体到"该用哪个后端框架"这种有明确技术权衡的问题上，模型之间确实会产生实质性的、有论据支撑的分歧。
- **复测中发现并修复的一个 bug**：section-compose 阶段的模型会给 topic_id 编一个更语义化的新字符串（比如把 outline 给的 `"4"` 改写成 `"backend-tech-stack-api-design"`），而不是照抄传入的原始 id——跟 propose/critique/revise/vote 阶段模型瞎编 `model_id`/`claim_id` 是同一类问题（mock 测试同样测不出来，因为 mock 一直老实回填）。已加上 `stampSectionAnswer` 覆盖逻辑，并让 mock provider 故意模拟这种"改写 id"的行为，让回归测试能真正测到这个修复。

## M2 补充：Backend API — 实际结果（已完成，2026-07-04）

- **先把 orchestrator 从 `apps/cli` 提取成共享包 `packages/orchestrator`**：这是把 M1 已经验证过的编排逻辑搬到服务端的前提——CLI 和 `apps/api` 现在 import 同一份实现，不是两处维护两套编排代码。提取过程中给 `DeliberationInput` 加了一个可选的 `runId` 覆盖字段（默认行为不变，CLI 不受影响），因为 API 需要在 run 完成前就知道 runId 才能立刻返回 `{runId}`，而不是依赖"`run_started` 事件在第一个 `await` 之前同步触发"这种隐式执行顺序假设。
- **技术选型**：HTTP 框架用 Fastify，DB 访问层用 Kysely（类型安全的 SQL query builder，不需要单独的 schema DSL/代码生成步骤）——都是让用户在两个方案里选、用户回复"你认为效果最好的"后按此确定，理由和 `packages/model-adapters` 手写 `resilience.ts` 而不引入重试库、`packages/protocol` 手写 zod schema 而不用 ORM 的一贯风格保持一致。
- **持久化设计**：`conversations`/`runs`/`run_events` 之外，`claims`/`reviews`/`candidates`/`votes` 四张表把每个 run 的详细数据落成可查询的行（`candidates.source_claim_ids` 保留 M0 的可追溯性约束），`run_results` 表存一份完整的 `DeliberationResult`/`PlanDocument` JSON 快照作为 `GET /result` 的直接数据源——两者都写，前者留给未来 UI 做按 claim 查询，后者保证"结果原样可还原"不依赖重新拼装归一化的行。
- **SSE 设计上的一个正确性细节**：`run-service.ts` 里终止事件（`run_completed`/`run_failed`）在广播前会等待"结果已经写入 `run_results` 表 + run 状态已经更新"这个 gate 完成——否则客户端可能通过 SSE 收到 `run_completed` 后立刻请求 `GET /result`，却因为写入尚未提交而扑空。非终止事件仍然按发出顺序异步持久化+广播，不阻塞 orchestrator 本身。
- **真实验证（2026-07-04）**：沙盒里没有 Docker，改用 Homebrew 装了本地 Postgres 16（`postmaster became multithreaded during startup` 是这台 macOS 上的已知问题，设置 `LC_ALL=en_US.UTF-8` 后可正常启动）实际跑通：
  - `apps/api` 的 16 个测试全部通过（含 2 个不需要数据库的纯单元测试 + 5 个 repositories 集成测试 + 5 个 routes 集成测试 + 4 个新增），其中一个专门验证"quorum 未达标时 run 被标记为 `failed` 而不是把进程拖崩"，另一个验证 SSE 断线重连按 `seq` 顺序正确回放且 `Last-Event-ID` 去重生效。
  - 手动 `curl` 冒烟测试：创建会话 → 发起 run（quick 模式）→ 状态从 `running` 变为 `completed` → SSE 重连正确回放完整事件日志 → `GET /result` 返回 schema 合法的最终答案；另外单独验证了 run 仍在进行时 SSE 的实时推送（一边跑 standard 模式一边看到 propose/critique/revise 阶段事件逐个到达）。
  - 全 workspace（`packages/protocol`、`model-adapters`、`prompts`、`orchestrator`，`apps/cli`、`apps/api`）的 `npm run build`/`npm run test` 均通过，零回归。
- **已知限制，不在这次范围内解决**：如果 API 进程在 run 执行中途重启，该 run 的内存态执行会丢失（`status` 会停留在 `running`，不会自动恢复或超时标记）。完整的跨重启可恢复性不在 M2 验收标准内，记录为后续待办，而不是被忽略。

**用真实模型（OpenRouter：GLM-5.2 / DeepSeek v4 Pro / Kimi-k2.6）跑通后又发现并修复了一个真实 bug**：planning 模式下，`candidate_id`（Normalize/Vote 阶段模型自己起的短 id，如 `cc_1`）从来没有像 `claim_id` 那样被 orchestrator 用 `stampProposal` 按 topic 加前缀隔离过——`packages/orchestrator` 内部按 topic 各自处理不受影响，但 `apps/api` 的 `saveResult` 把所有 topic 的 candidates/votes 拍平进同一张表时，第一次真实的多主题 planning run（"给 3 人团队的电商项目做技术选型规划"，7 个主题）就直接命中了 `duplicate key value violates unique constraint "candidates_pkey"`，因为不同主题的模型都习惯性地把第一个候选命名为 `cc_1`。因为整个写入在一个事务里，这次失败连同一次跑了近 10 分钟的真实模型调用结果一起被回滚丢失了。事后发现 `MockProvider` 的 `mockNormalize` 其实一直都是每个 topic 确定性地吐出 `cc_1`/`cc_2`/...，这个 bug 本该在 mock 测试下就能 100% 复现——只是在这次真实测试之前，没有任何测试真正对一个 planning 模式的结果调用过 `saveResult`。这是这个项目第三次踩到"没人在这条代码路径上认真测过"的坑，跟 M1 的 `stampProposal`/`stampCritique` 和 v0.2 的 `stampSectionAnswer` 是同一类问题，只是这次出现在持久化层而不是 orchestrator 内部。修复：`results-repo.ts` 改成按 topic 显式分桶（不再用 `Object.assign`/`flatMap` 把所有 topic 的数据揉在一起），DB 里的 `candidate_id`/投票的 `candidate_id` 统一加上 `${topicId}::` 前缀（只影响 DB 列，`run_results` 里的 JSON 快照保持 orchestrator 原样输出的 id 不变），并按各自 topic 的 `classifications` 查表而不是合并后的字典（后者在 id 碰撞时会静默拿错分类结果，比崩溃更隐蔽）。补充了一个用 `MockProvider` 真正调用 `saveResult` 落库、断言"52 个候选跨 7 个主题无重复、每行分类都对应各自主题"的回归测试；同时发现 `apps/api` 的两个集成测试文件在共享同一个真实 Postgres 时被 vitest 默认的按文件并行执行改出过一次偶发的外键冲突（一个文件的 `truncateAll` 冲掉了另一个文件刚插入的行），顺手把 `fileParallelism` 关掉。修复后重新跑同一个真实 planning 请求（这次拆成 7 个主题），完整跑完（约 586 秒），DB 里 52 条 candidates/156 条 votes 无冲突，且真实复现了一次有意义的分歧——"前端主框架 Vue+Nuxt3 vs Next.js 未达成共识"被正确分类为一条 `rejected` + 两条 `qualified_consensus`，而不是被多数票压成 `strong_consensus`。

### M2：Backend API（已完成，同原文档骨架 + 两处刻意偏离）

- Conversation / Run API、SSE 事件流、Postgres 持久化、错误重试——同原文档骨架，均已落地。✅
- Model Adapter 复用 M0 定义的 quorum / 超时 / 重试策略（`fanOutWithQuorum`），不是简单的 `Promise.all`——这部分本来就在 `packages/model-adapters` 里，M2 直接复用，未改动。✅
- Persistence 层的 claims/reviews/candidates/votes 表用 M0 修正后的复合/run 隔离 schema（`run_id` + 本地 id 复合主键），未照抄原文档第 7 章未修正的 DDL。✅
- **两处刻意偏离原文档**（详见 [docs/protocol.md](docs/protocol.md)"M2：Backend API"一节）：(1) 模型选择改为服务端 `models.config.json` 注册表，创建 run 的请求只能从中选 `modelIds` 子集，不接受客户端自带 `provider`/`baseUrl`（避免 SSRF 和客户端自带 API key）；(2) 不引入 Redis——单进程内存 SSE 广播器 + Postgres 持久化（供断线重连回放）已满足 M2 验收标准，跨进程事件分发留到真正需要水平扩展时再做。

## M3 补充：Web MVP — 实际结果（已完成，2026-07-04）

- **先补两个 M2 遗漏的小接口**：`GET /api/models`（暴露 `ResolvedProvider.availableModelIds`/`modelIdToProviderLabel`，供前端模型选择用）和 `GET /api/conversations`（会话列表，此前只有按 id 查询）——都是纯新增，不改协议、不改 schema。
- **技术选型**：`apps/web` 用 Next.js 16（App Router）+ React 19 + Tailwind CSS 4，跟原文档第 6 章推荐一致。前端与后端的连接方式选了 Next.js `rewrites()` 同源代理而不是给 Fastify 加 `@fastify/cors`——同源代理不需要维护 origin allowlist/preflight，也不用管跨源 `EventSource` 的 cookie 细节，跟这个项目一贯"能不加基础设施就不加"的风格一致（对应不引入 Redis、手写 `resilience.ts` 而不用重试库的同一类决策）。状态管理和数据获取用原生 `fetch`/`EventSource`+ hooks，没有引入 React Query/SWR。
- **共识面板的数据来源做了一个跟原计划不同、但更干净的选择**：最初设想是从 `final.strong_consensus` 这类纯文本数组反查回 candidate 对象，实现时发现 `DeliberationResult.classifications`（`Record<candidate_id, ClassifyCandidateResult>`）已经能直接按 `candidate_id` 查到分类标签——这正是 orchestrator 内部 `computeConsensusBuckets` 生成 `final.strong_consensus` 等数组时用的同一份数据。于是前端直接对 `normalize.candidate_claims` 按 `classifications[candidate_id].label` 分桶，拿到完整的 `CandidateClaim` 对象（含 `source_claim_ids`），不用再做容易出错的文本反查。
- **真实模型测试中发现并修复了一个真实 bug（不是 mock 测试能测出来的那类）**：`apps/web` 开发服务器通过 `next.config.ts` 的 `rewrites()` 代理 `/api/*` 到后端时，Next 默认开启的 gzip 压缩会缓冲被代理的响应体——对普通 JSON 接口无感，但对 `GET /api/runs/:id/events` 这个长连接 SSE 流是致命的：压缩需要攒够数据才 flush，而 SSE 消息之间间隔可能有几十秒（真实模型一个阶段就要 76 秒+），导致浏览器端的 `EventSource` 收不到任何实时数据，直到连接结束才会一次性吐出所有内容。用 `fetch()` 读原始 response body 才定位到 `content-encoding: gzip` 这个线索。修复：`next.config.ts` 里显式 `compress: false`。这个 bug 只有真跑真实模型、真等待几十秒的阶段间隔才会暴露——mock provider 几乎瞬间返回，压缩缓冲的影响感觉不出来。
- **一个刻意的健壮性设计，被真实环境意外验证了**：读 `packages/orchestrator/src/index.ts` 时发现 planning 模式有个既有缺口——如果 outline 拆出的所有 topic 全部失败（`topics.length === 0`），代码直接 `throw`，从未调用 `emit("run_failed", ...)`，也就是说 SSE 流永远不会收到终止事件，只会一直挂着。为此前端没有完全依赖 SSE 的 `run_completed`/`run_failed` 来判断"跑完了没有"，而是额外加了一个独立的 `GET /api/runs/:id` 轮询（`useRunStatus`，5 秒一次，跟 SSE 并行、不依赖它）。这个设计决策在真实测试中被意外命中验证：测试 planning 模式时 OpenRouter 账号额度耗尽，7 个 topic 全部因 402 报错失败，SSE 连接确实如预期一直挂着没有终止帧，但轮询正确检测到 `status: "failed"` 并把 UI 切到错误视图——如果没有这个轮询兜底，页面会永久卡在"运行中"。
- **真实验证（2026-07-04，OpenRouter：GLM-5.2 / DeepSeek v4 Pro / Kimi-k2.6）**：
  - Quick 模式和 Standard 模式各跑通一次完整真实流程：提问 → 模型多选 → 提交 → SSE 实时阶段进度 → 完成后最终答案 + 共识面板 + 可展开的原始 claim 溯源（含一次带 revise 记录的溯源展示）+ 复制最终答案。
  - Standard 模式中途刷新页面：正确通过 `Last-Event-ID` 回放恢复到当前实际进度（不会重置成"全部未开始"）；已完成的 run 刷新页面：直接跳过 SSE、走 `GET /result`，网络面板确认完全没有发起 `EventSource` 连接。
  - Planning 模式的实时进度（outline 步骤 + 每个 topic 独立的阶段进度条，按 SSE 事件里的 `topicId` 字段路由）在真实模型下验证正确；受账号额度限制，最终"成功完成"的 `PlanDocumentView` 渲染当时改用 mock provider 补验证。
  - 移动端宽度（375px）下侧边栏正确收起为可展开的抽屉。
- **账号额度补充后用真题重跑 planning 模式，又发现并修复一个真实问题**：换了个新问题（"给运行若干微服务的小团队规划可观测性技术栈：选日志方案和指标监控方案"）真实跑完 6 个 topic，`PlanDocumentView` 首次用真实数据渲染时发现 `section_answer`/`final_answer`/`executive_summary` 这类"文档体"字段，真实模型经常会按 markdown 格式输出（`## 标题`、`### 小节`、列表等）——`standard`/`quick` 模式的 `final_answer` 是一段连续陈述，之前测试没有触发这个问题，但 planning 模式的 `section_answer` 明确是"文档一节"，模型自然会用 markdown 分节。修复前 UI 是把这些字段当纯文本用 `whitespace-pre-wrap` 展示，`##`/`###` 会原样露出。加了 `react-markdown` + `remark-gfm`（新增依赖，两个都是这个生态里最主流的选择，手写 markdown 解析不划算）渲染这三个字段，标题映射到比面板自身标题低一级的 `h3`/`h4` 避免视觉冲突。这次真实数据还顺带验证了一个有意义的分歧——"Instrumentation Strategy"主题里，"是否该用 OpenTelemetry 统一处理 metrics 还是分开用 Prometheus 原生格式"被正确分类为 `disputed`（源头是提出该方案的模型自己在投票阶段反对把它和另一方案并列），溯源展开也正确显示了该 claim 的 revise 记录。
- **测试覆盖**：新增 13 个前端纯函数单测（`estimate`/`traceability`/`consensus`/`progress` 四个模块）+ 2 个后端 `/api/models` 单测 + 1 个 `/api/conversations` 列表集成测试，全 workspace 136 个测试全部通过，零回归。

### M3：Web MVP（已完成，同原文档 + 新增透明性和预估展示）

- 问题输入、模型选择、运行进度、讨论过程折叠展示、最终答案和共识面板——同原文档。✅
- 新增：候选共识（candidate claim）旁边有入口可展开查看合并前的原始 claims（对应 M0 的透明性兜底）。✅
- 新增：运行前展示预估耗时（不含预估成本——项目目前没有 per-model 定价/token 计费基础设施，成本估算推迟到 M4，避免展示编造的数字）。✅

## M4 第一阶段补充：BYOK 平台 — 实际结果（已完成，2026-07-04）

讨论后明确 M4 不做原文档设想的登录/账号体系——改成"自带 key"（BYOK）平台：用户从一个受限的 provider 白名单里选厂商、填自己的 API key 来跑协商，而不是只能从服务端 `models.config.json` 选模型。这直接反转了 M2 的一处刻意决策（当初为了避免 SSRF 和客户端自带 key，把模型选择收敛成服务端注册表）——重新打开"客户端自带 key"，但仍然通过白名单固定 `baseUrl` 保留 SSRF 防护，而不是接受任意客户端 baseUrl（后者需要内网地址过滤、DNS rebinding 防护、重定向校验、IP 编码解析这一整套加固，评估后判断工作量明显更大，作为明确记录的后续待办，不在这次做）。

- **Provider 白名单**（`packages/protocol/src/provider-whitelist.ts`）：第一批只上 OpenAI 兼容格式的 OpenAI/DeepSeek/OpenRouter/Volcengine（Ark），全部复用现有 `OpenAICompatibleProvider`；Anthropic/Google 因为不是 OpenAI 兼容格式、需要专门 adapter，评估后判断先不做，记为后续待办。
- **按 run 构造 provider**：`apps/api/src/config/provider-factory.ts` 新增 `buildRunProvider()`，在每次 `POST /runs` 请求时把"选中的服务端注册表模型"和"客户端自带 key 新建的 `OpenAICompatibleProvider` 实例"合并成一个 `RoutingProvider`，跟启动时构造一次的 `buildProvider()`（继续服务于服务端注册表）完全分开，互不影响。`packages/model-adapters` 的 `OpenAICompatibleProvider` 加了 `apiKey` 字面量选项，优先于 `apiKeyEnvVar`。
- **一个必须解决的隐藏问题**：`GET /api/conversations` 原本不做任何隔离，是全局列表——单人自托管没问题，但 BYOK 的本质就是"让陌生人用你部署的这个实例"，一旦有多个匿名访客会立刻变成数据泄露。解决方案：给每个访客自动签发一个匿名 workspace/session cookie（`mmd_workspace`，httpOnly + 生产环境 secure + sameSite=lax，一年有效期，不含 PII，不需要额外同意弹窗），新增 `workspaces` 表，`conversations`/`runs` 都加了可空的 `workspace_id` 外键并按它过滤/校验归属（不属于当前 workspace 一律 404，不用 403，避免向无权限方确认资源存在）。
- **可选持久化 key**：用户可以给每个自带的模型条目单独勾选"记住这个 key"（按条目独立开关，不是整个请求一个开关），此时后端用 AES-256-GCM（密钥来自新增的 `ENCRYPTION_KEY` 环境变量，`apps/api/src/crypto/key-encryption.ts`）把 key 加密存进新增的 `workspace_api_keys` 表（`unique(workspace_id, provider_id, model_id)`，同一模型再存一次是替换而不是重复）。`GET /api/workspace/keys` 只返回 provider/model/label 元数据，从不返回明文或密文。复用时前端调用这个接口拿到元数据后，创建 run 只传 `savedKeyId`（不传 `apiKey`），服务端在 `POST /runs` 里按 `(savedKeyId, workspaceId)` 解密出明文、内部构造 provider，浏览器全程不再持有明文——这是刻意的安全要求，用来避免把明文 key 存进 `localStorage`（更差的方案，容易被 XSS 读取）。
- **安全验证**：新增测试显式断言 `runs.model_config`、SSE 事件、`workspace_api_keys` 的原始加密列都不包含调用方传入的 key 字符串（这个项目历史上已经三次踩过"mock 太听话，真实数据路径才暴露 bug"的坑，这里提前用测试防一次而不是等真实调用暴露）。
- **真实验证（2026-07-04）**：本地 Homebrew Postgres 16 上跑通全部迁移（`0002_workspaces.sql`、`0003_workspace_api_keys.sql`），全 workspace 172 个测试（含 44 个 `apps/api` 测试，多数是打真实 DB 的集成测试）全部通过，零回归。另外起了真实的 `apps/api`/`apps/web` 开发服务器，用浏览器实测：两个模拟访客（不同 cookie）互相看不到对方的会话列表、跨 workspace 访问会话/run 返回 404；在 Web UI 里添加一个 BYOK 模型、勾选"记住"、提交后混合服务端注册表模型跑一次 run，`psql` 直接查库确认 `model_config`/加密后的 `workspace_api_keys.encrypted_key` 都不包含明文 key；刷新页面后 `SavedKeysPicker` 正确展示"已保存的 OpenAI key"，点击"Use"复用后创建的 run 同样验证无泄漏，且实际发起的 HTTP 请求 `Authorization` header 用的是解密后的正确 key。
- **已知不在这次范围内的后续待办**：完全自定义 baseUrl（需要额外 SSRF 加固）；Anthropic/Google 专用 adapter；加密密钥轮换机制（轮换 `ENCRYPTION_KEY` 需要离线重新加密所有行，没有做在线轮换）；删除已保存 key 的接口（目前只有查看/复用，没有做删除，只读元数据 + 复用已经是完整可用的最小功能集）。
- **同一批 M4 里官方范围列出、但已经在更早阶段做掉的项**：quick mode 在 Web UI 里的开关（M3 的 `ModeSelector` 已经支持 `standard`/`quick`/`planning` 三选一，不需要再补）。

### M4 到此结束

BYOK 做完之后，M4 就此收尾，不再往里加新范围。原计划挂在 M4 名下的成本估算/熔断、分享链接，连同这次做完 BYOK 之后新发现的几个"项目收尾"缺口（CI、限流/数据清理、部署路径），一起归到新的 M5，按优先级排好顺序，供下一阶段开发参考。

## M5：项目收尾与生产就绪（进行中，M5.1 已完成）

BYOK 把这个项目从"自用脚本/单人自托管工具"变成了"可以让陌生人用的平台"，这个身份转变本身带来了一批新的、真实的缺口——不是锦上添花，是"当前状态下如果真的被多人使用会出问题"的那类。M5 把这些缺口和原本就挂在 M4 名下、还没做的两项（成本熔断、分享链接）放在一起排出优先级：

**成本熔断 → CI → 限流/数据清理 → 部署文档 → 分享链接**

排序依据：成本熔断是唯一一个"不做就有真实伤害"的（用户用自己的 key，失控调用会在不知情的情况下烧钱）；CI 是"改动范围小、但从此以后每次改动都受益"的一次性投入，且这次能直接 push 到 main 完全是靠人肉跑了 172 个测试，没有任何自动化兜底；限流/清理和部署路径都是"BYOK 开放给陌生人"之后才变得紧迫，但没有前两项那么紧急；分享链接纯粹是增量功能，没有安全/正确性风险，排最后。

### M5.1 成本估算与熔断（最高优先级）

**为什么**：BYOK 平台里用户拿自己的 key 跑 run，如果没有任何熔断，一次失控的调用（尤其 planning 模式最多 8 个主题、每个主题都要跑完整六阶段）可能在用户完全不知情的情况下烧穿自己账号的额度或触发厂商侧的高额账单。这是 M5 里唯一一项"不做就有真实伤害"的工作。

**前置缺口（必须先补，否则无法做任何真实的成本判断）**：`packages/model-adapters` 的 `CompletionResult`（当前只有 `{text, latencyMs}`）完全不追踪 token 用量——`OpenAICompatibleProvider.complete()` 只读了 `data.choices[0].message.content`，从没解析过响应体里真实存在的 `usage` 字段。做熔断的第一步必须先把这条数据通道打通。

**写这一节之前，实际查了白名单四家 provider 的官方文档**（第一版草稿是凭通用知识猜的"一张统一 $/token 定价表"，查证后发现这个假设站不住——四家的 `usage` 字段形状和计价方式并不统一，直接影响设计）：

- **OpenRouter**（[Usage Accounting 文档](https://openrouter.ai/docs/cookbook/administration/usage-accounting)）：`usage` 现在**默认自动带一个 `cost` 字段**（旧的 `usage.include`/`stream_options.include_usage` 请求参数已废弃，官方原话"完整用量信息现在自动包含在每个响应里"），单位是账户里的 credits，就是这次请求的真实扣费金额。更关键的是 `cost_details.upstream_inference_cost` 这个字段**专门为 BYOK 请求**暴露真实的上游供应商成本——这正好是我们的场景。**结论：OpenRouter 不需要自己维护定价表，直接读响应里的 `usage.cost` 就是权威数字，比自己算的估算更准。**
- **DeepSeek**（[Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)）：`prompt_tokens` = `prompt_cache_hit_tokens` + `prompt_cache_miss_tokens`，两者单价相差约 50 倍（官方定价页示例：cache hit ¥0.0028/1M vs cache miss ¥0.14/1M）。**如果按"一个 input 单价"简单套用，估算可能偏差 50 倍**——必须把这两个字段分开算，缓存命中率完全取决于运行时的 prompt 重叠情况，无法提前预测，只能用"当次真实返回的 hit/miss 拆分"做事后核算，不能用于运行前预估。
- **Volcengine (Ark)**：`usage` 是标准 OpenAI 形状（`prompt_tokens`/`completion_tokens`/`total_tokens`），但豆包系列有基于输入/输出长度门槛的促销价（比如"input ≤32K 且 output ≤200 tokens 时 output 降到 ¥2/1M"），一张固定定价表只能是近似值，无法精确匹配这种条件性定价。
- **OpenAI**：标准 `usage: {prompt_tokens, completion_tokens, total_tokens, prompt_tokens_details: {cached_tokens, audio_tokens}, completion_tokens_details: {reasoning_tokens, ...}}`；这个项目实测用的是真实推理模型（见 M1.5/v0.2 的耗时基线），`reasoning_tokens` 是 `completion_tokens` 里的一个子集细分，计费口径上已经算在 `completion_tokens` 总数里，不需要额外加算。

**设计要点（按上述核实结果修正）**：
1. 扩展 `CompletionResult` 加 `usage?: {promptTokens, completionTokens, totalTokens, costUsd?: number, raw?: unknown}`——`costUsd` 用于 provider 直接报告成本的情况（OpenRouter），`raw` 保留原始 `usage` 对象供 provider-specific 的计价逻辑读取额外字段（DeepSeek 的 cache hit/miss 拆分）。`OpenAICompatibleProvider` 从响应体解析填充；`MockProvider` 也必须返回一个确定性的假 `usage`，不能省略——这个项目已经三次踩过"mock 太听话，真实数据路径才暴露 bug"的坑（见 M1/v0.2/M2 补充里的 `stampProposal`/`stampSectionAnswer`/candidate id 三个案例），这里提前用同样的纪律防一次。
2. 新增 `packages/protocol/src/pricing.ts`，但**不是一张统一定价表**，而是按 `providerId` 分派的计价策略：
   - `openrouter`：不查表，直接用响应里的 `usage.costUsd`（换算自 `cost`/`upstream_inference_cost`）累加，这是最准的路径。
   - `deepseek`：定价表按 `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`/`completion_tokens` 三档分别算，不能只按 `prompt_tokens` 总数算。
   - `openai`/`volcengine`：标准 $/1K token 定价表，Volcengine 的促销门槛价明确标注"近似值，未覆盖条件性定价"，不承诺精确。
   - BYOK 的 `modelId` 是自由文本，无法保证认出用户填的每一个型号——认不出时的行为必须明确定义：**不阻断 run，但明确告知"无法估算成本，本次不会有熔断保护"**，而不是假装展示一个编造的数字（跟 M3 当初"不展示编造的成本数字"是同一条纪律）。
3. `packages/orchestrator` 的 `runDeliberation`/`runTopicDeliberation` 里维护一个跨阶段累加的成本计数器（调用上面的按-provider 计价策略，而不是自己再实现一遍），每次模型调用后更新；每个阶段开始前检查是否已超过阈值（默认值 + `POST /runs` 可选的 `costLimitUsd` 覆盖，默认数字需要跟用户确认，不要凭空定）。超过时的处理要跟现有 quorum 失败路径一致：不是进程崩溃，是把 run 标记为 `failed`，`error` 给出明确原因（如 `cost limit exceeded: estimated $X > limit $Y`），发 `run_failed` SSE 事件。
4. UI 层面复用 `TimeEstimateLine` 的位置，加一个 `CostEstimateLine`——OpenRouter 模型可以展示"实时精确成本"的说法（因为是真实回传的数字），其他 provider 只能展示"预估区间"；无法识别的 model 明确提示"这个模型无法估算成本、不会被熔断保护"。

**验收标准**：计价策略函数是纯函数，按 provider 分别测试（OpenRouter 直接读 `costUsd`；DeepSeek 验证 cache hit/miss 分开算而不是按 `prompt_tokens` 总数算；未识别 model 既不阻断也不熔断）；用 `MockProvider` 构造一个 usage/cost 持续累积超过阈值的场景，验证 run 在跑完全部阶段之前就被标记为 `failed` 且不崩溃（跟现有 quorum 失败的测试是同一种验证方式）；真实模型下（至少覆盖一次 OpenRouter 请求）确认 UI 展示的成本预估和真实 usage/cost 数字量级一致。

### M5.1 成本熔断 — 实际结果（已完成，2026-07-04）

设计基本按上面几节落地，实现中的几处细节：

- **`packages/protocol/src/pricing.ts` 用 `precision: "exact"|"approximate"|"unknown"` 三态而不是一个布尔值**——OpenRouter 是 `exact`（真实回传），DeepSeek/OpenAI/Volcengine 是 `approximate`（静态汇率/缓存拆分算出来的），认不出的 provider/model 是 `unknown`。三态比"能不能估算"这一个布尔位携带更多信息，UI 后续想按精度分级展示时不用再反推。
- **OpenAI/Volcengine 没有做成"逐 SKU 定价表"，改成单一 blended $/1M-token 汇率**——原计划里"标准 $/1K token 定价表"暗示的是逐模型精确匹配，实现时发现这个精细度收益不大：新模型上线速度比手工维护的表快，与其做一张注定很快过时的全 SKU 表，不如一开始就用一个明确标注"近似"的汇率，跟"不展示编造的精确数字"是同一条纪律，只是把它用到了"精度"这个维度而不只是"有没有数字"。
- **汇率数字被指出两处问题后重新核实并修正（同日，2026-07-04）**：第一版实现把具体汇率数字直接写死在 `pricing.ts` 的计算逻辑里，且部分数字来自对第三方聚合站点的搜索摘要，没有直接核对官方文档。用户指出后重新处理：(1) 把汇率数字拆到独立文件 `packages/protocol/src/pricing-rates.ts`，每条带 `sourceUrl`/`asOf`/`confidence` 字段，跟计价逻辑彻底分开，以后刷新一个数字是编辑数据而不是改代码；(2) 直接抓取官方文档原文重新核实数字，结果发现两处实质性错误：**DeepSeek** 原写的 cache hit $0.0028/1M、cache miss $0.14/1M 是错的，官方 `pricing-details-usd` 文档的真实数字是 `deepseek-chat` cache hit $0.07/1M、cache miss $0.27/1M、output $1.10/1M（cache hit 单价差了约 25 倍）；**OpenAI** 原用的 GPT-4.1 $2/$8 对应的模型在当前定价页里已经找不到了（已被 gpt-5.x 系列取代），改用当前主力档位 gpt-5.4 的 $2.5/$15。**Volcengine** 的官方定价页是 JS 渲染、抓不到正文，多个第三方来源互相矛盾，最终用了几个独立来源都认可的 ¥6/¥30（Doubao 2.1 系列，换算成约 $0.84/$4.20），并显式标注为四个 provider 里置信度最低的一个（`confidence: "low-confidence-secondary-sources"`）。教训：查证据要查一手文档，不能只信搜索引擎给的摘要，尤其是会被用来做真金白银熔断判断的数字。
- **成本累加器的挂载点比预想的更深**：`packages/orchestrator` 的 `structuredCall()` 原本只返回 `callStructured` 解析后的结构化值，把 `CompletionResult`（含 `usage`）直接丢弃了。要让每次模型调用的 usage 都能被记账（包括 JSON 校验失败后的重试调用——重试也是真实花钱的调用，不能只算最后一次成功的），给 `structuredCall` 加了一个 `onUsage` 回调参数，而不是在每个阶段外面另起一次调用去拿 usage。
- **Planning 模式的熔断颗粒度**：由于各 topic 用 `Promise.allSettled` 并行跑，没有办法真正"停止已经在飞的调用"，所以熔断检查点设在"每个阶段开始前"而不是"超过阈值的瞬间"——一个共享的 `CostState` 对象按引用传给每个 `runTopicDeliberation` 调用，任一 topic 先观察到超阈值就在自己的下一个检查点熔断，其余 topic 的下一个检查点也会看到同一个共享状态并跟着停，代价是"最多再多花一轮已经在飞的调用"，跟现有 quorum 机制"优雅但非瞬时"的降级哲学一致，没有引入新的取消/中断机制。
- **顺带修的一个 bug**：过程中发现 planning 模式如果所有 topic 都失败（`topics.length === 0`），orchestrator 原本直接 `throw`，从未 `emit("run_failed", ...)`——这个缺口本来就记在 M3 补充一节的"已知后续待办"里，但因为成本熔断让"所有 topic 因同一个共享阈值一起失败"变成一个会真实发生的场景（不再只是多模型同时宕机这种边缘情况），顺手修掉了，不然新功能会让老 bug 命中率显著上升。
- **一个必须补的持久化缺口**：`run_results` 表原本是逐字段落库（`proposals`/`critiques`/.../`quorum` 各一列），不是存一个完整 JSON 快照——加 `cost` 字段意味着必须新增一次迁移（`0004_run_results_cost.sql`，`alter table run_results add column cost jsonb`）而不能只改 TypeScript 类型，这点在写代码前没有充分预料到（一开始以为可以复用某个已有的 JSON 快照列）。
- **真实验证（2026-07-04，浏览器 + 本地 Homebrew Postgres 16，`MockProvider`）**：起了真实的 `apps/api`/`apps/web` 开发服务器（无 `models.config.json`，自动退回 mock，不发真实网络请求），完整走了一遍 UI：quick 模式一次正常 run 完成后正确显示 "Cost so far: $0.0004"，`psql` 直接查 `run_results.cost` 列确认落库值为 `{"limitUsd": 5, "totalUsd": 0.0004, "hasUnknownPricing": false}`；standard 模式故意把 `costLimitUsd` 设成一个极小值后，run 在 propose 完成、critique 开始前被正确标记为 `failed`，前端复用既有的 `ErrorPanel`（没有新增专门的错误展示组件）正确显示 "cost limit exceeded before "critique": estimated $0.0003 so far > limit $0.00"；全程浏览器控制台和服务端日志均无异常。全 workspace（8 个 workspace）`npm run build`/`npm run test` 均通过，198 个测试零回归。
- **未做的验证**：沙盒环境没有可用的真实 BYOK key，没有打过真实的 OpenRouter/DeepSeek/OpenAI/Volcengine 请求核对 `usage.cost`/token 计数解析和汇率换算的准确性——只验证了 `packages/protocol/test/pricing.test.ts` 里计价策略函数本身在给定 usage 输入下的纯函数正确性，以及 `MockProvider` 路径下整条链路（表单 → API → orchestrator → DB → 前端展示）的真实集成行为。**这是明确的后续待办**：接入真实模型后，第一件事应该是核对 OpenRouter 返回的 `usage.cost` 量级是否与账户账单一致，以及 OpenAI/Volcengine 的 blended 汇率算出来的近似值和真实账单差多少（预期会有偏差，只是想知道偏差量级）。
- **没有做的事**（有意收窄范围，不是遗漏）：没有给 `phase_completed` SSE 事件逐个附加实时累加成本（只在 `run_completed`/`run_failed` 里带），运行中的实时成本走势没有做；没有给服务端注册表模型（`models.config.json`）补 `providerId` 字段以支持计价（这条路径本来就不是 BYOK 场景，且是管理员配置的，风险和优先级都更低）；`costLimitUsd` 本身没有存进 `runs` 表（只在跑完后随 `run_results.cost.limitUsd` 一起可见），因为前端提交时本来就知道自己传了什么，不需要服务端回显。

#### M5.1 follow-up：BYOK 用户自填计价（2026-07-04，同日）

用户指出内置汇率表这条路子本身有问题——"没法每次都抓最新数据，那就该让用户自己填"。加了一条独立的计价路径：

- **`calculateCostUsd` 新增 `userRate` 参数**，优先级 provider 真实回传成本 > `userRate` > 内置近似表 > unknown。`userRate` 在 dispatch 最前面统一处理，不挂在具体某个 provider 分支下——一个完全不在白名单里的 provider，只要用户填了 `userRate` 也能被计价，这是内置表覆盖不到的场景的唯一兜底。`PricingPrecision` 加了第四态 `"user-provided"`，跟"我们猜的"（`approximate`）和"provider 说的"（`exact`）区分开。
- **随 BYOK key 持久化**：`workspace_api_keys` 新增 `input_per_million`/`output_per_million`（迁移 `0005_workspace_api_keys_pricing.sql`，故意用 `double precision` 不用 `numeric`——后者 node-postgres 默认返回字符串，会悄悄破坏 TS 类型声明）。请求级别的覆盖优先于已保存的持久化汇率，且只影响这一次 run，不改动存储值。
- **踩到的一个真实 bug，顺带发现了架构上的一条隐藏规则**：给 `ByokModelForm` 加"建议汇率"预填时，第一版直接从前端 `import { OPENAI_RATE, ... } from "@mmd/protocol"`，`next build` 报 "Module not found: Can't resolve './budget.js'"。查下来发现 `apps/web` 此前对 `@mmd/protocol` 的所有引用都是 `import type`（编译期擦除，从未进入 Turbopack 打包图）——这是第一次真正的运行时值导入，暴露出 Turbopack 处理"来自 node_modules 符号链接的原始 TS 包、内部用 `.js` 后缀导入 `.ts` 文件"这种写法时会失败（`tsc`/`tsx`/`vitest` 都认得这种写法，Turbopack 不认，加 `transpilePackages` 也没用，因为那只解决"转不转译"，不解决扩展名映射）。修复：不让前端直接导入计价包，改成服务端算好（`GET /api/providers` 响应加 `suggestedRate` 字段），前端照常 `fetch`——跟 `/api/models`/`/api/providers` 一贯的"前端只拿数据、不拿运行时逻辑"架构完全一致，比跟 Turbopack 较劲更省事。
- **真实验证（同日，浏览器 + 本地 Postgres）**：切换 provider 下拉框时价格建议正确联动（OpenAI 2.5/15，DeepSeek 切到 cache-miss 档 0.27/1.1，OpenRouter 清空无建议）；手动改成 1.23/4.56、勾选"记住"提交后，`psql` 直接查 `workspace_api_keys` 确认两列落库正确；新会话里 `SavedKeysPicker` 正确显示 "openai:gpt-4.1-mini ($1.23/$4.56 per 1M tokens)"。全 workspace 8 个包 `npm run build`/`npm run test` 均通过，214 个测试零回归（较 M5.1 初版的 198 个新增 16 个）。

### M5.2 CI（第二优先级）

**为什么**：现在能不能把一次改动合并进 main，完全靠人手动跑测试——这次 BYOK 的 172 个测试和真实 Postgres 验证全部是本次会话里手动跑的。下一次换一个人改代码、忘了跑测试就直接 push，没有任何东西会拦下一个坏 commit。这是这批里成本最低、但收益最持续的一项。

**设计要点**：
1. 新增 `.github/workflows/ci.yml`，在 push/PR 到 `main` 时触发。
2. Job 需要一个 Postgres service container（`postgres:16-alpine`，跟 `docker-compose.yml` 的用户名/密码/库名保持一致），设置 `DATABASE_URL` 指向它——`apps/api` 的集成测试目前检测不到 `DATABASE_URL` 时会静默跳过（`hasTestDatabase()`），CI 里必须真的跑起来，否则等于没测。
3. 步骤：`npm ci` → `npm run build`（全 workspace）→ `npm run db:migrate --workspace=apps/api` → `npm run test`（全 workspace）。
4. 必须保留 `apps/api/vitest.config.ts` 里已经设置的 `fileParallelism: false`——这个项目自己在 M2 阶段就踩过"两个测试文件并行跑同一个真实 DB 导致偶发外键冲突"的坑（见 M2 补充一节），CI 环境不应该绕开这个设置。
5. 跑通后可以在 README 顶部加一个状态徽章。

**验收标准**：workflow 在当前代码库上跑绿；故意在一个分支里引入一个会让某个测试失败的改动，确认 CI 正确标红，验证"红灯真的能拦人"这件事本身。

### M5.2 CI — 实际结果（已完成，2026-07-05）

按设计新增了 `.github/workflows/ci.yml`（Postgres service container + `npm ci` → `npm run build` → `npm run db:migrate --workspace=apps/api` → `npm run test`，`fileParallelism: false` 未改动），README/README.en 顶部加了状态徽章。

**实现前先在一个全新 worktree 里验证时，意外发现并修复了一个从未被本地开发流程暴露过的真实 bug**：这个 worktree 是本次会话第一次 `npm install`（之前从未 build 过），从零 build 时 `npm run build` 直接失败——`packages/prompts`（以及 `orchestrator`/`cli`/`api`）用的是 TypeScript **composite project references**（各 `tsconfig.json` 有 `references` 数组指向依赖包），但根 `package.json` 的 `build` 脚本是 `npm run build --workspaces --if-present`，npm 对 workspaces 默认按**字母序**而非依赖顺序执行——实测顺序是 `model-adapters → orchestrator → prompts → protocol → api → cli → web`，`prompts` 会在它依赖的 `protocol` 还没 build 出 `dist/*.d.ts` 之前就先跑，导致 `tsc -p`（非 `-b`，不会自动按依赖顺序级联 build 引用项目）报 `TS6305`。这个 bug 理论上从 M2 引入 `packages/orchestrator`/`prompts` 的项目引用结构起就一直存在，但从未在任何一次会话里被撞见——因为本地开发是同一个目录里反复手动跑 `npm run build` 一整个下午/多天，`dist/` 从未被清空过，很久以前（`packages/protocol` 刚创建、还没有其他包依赖它的时候）就已经按正确顺序 build 出来过一次并留在磁盘上，之后字母序重跑时下游包总能读到已经存在且未过期的上游 `dist`，问题被"从未 clean build"这个巧合掩盖了。CI 恰恰是唯一一个每次都是真正全新 checkout（没有历史 `dist/` 残留）的环境，如果不修，CI 第一次跑就会红，且红的原因跟这次改动完全无关——这会让 CI 从一开始就失去可信度。**修复**：把根 `package.json` 的 `build` 脚本从 `--workspaces --if-present` 改成显式按依赖顺序串联的 `--workspace=` 调用（`protocol → model-adapters → prompts → orchestrator → cli → api → web`），不引入 `tsc -b`/新构建工具，只是把已有的隐式顺序假设写成显式命令。`test` 脚本不受影响——各包 `package.json` 的 `main`/`types` 直接指向 `src/index.ts`（不是 `dist`），vitest/tsx 走的是源码而非 project-reference 的 `.d.ts` 解析路径，跟这次的 build-only 问题是两条独立的解析路径。
- **真实验证（2026-07-05，本地 Homebrew Postgres 16）**：`rm -rf` 清空全部 6 个包/应用的 `dist`、`tsconfig.tsbuildinfo` 和 `apps/web/.next` 后，`npm run build` 一次性全绿（修复前必现 `TS6305` + 下游级联的假 `Property does not exist` 报错）。另外新建了一个真正空白的 Postgres 库（`mmd_ci_fresh_test`，跟已经跑过多次业务的本地 `mmd` 库区分开）跑 `npm run db:migrate --workspace=apps/api`，5 个迁移文件（`0001`–`0005`）从零按序全部应用成功；对着这个全新库跑 `apps/api` 的 53 个测试全部通过。全 workspace（8 个包）`npm run test` 214 个测试零回归。
- **未做的验证**：还没有真的 `git push` 触发一次 GitHub Actions 实际运行，也没有验证"故意引入一个坏改动、确认 CI 标红"这条验收标准——这两步都需要推送到远程仓库，按操作规范需要用户明确授权/确认后再做，不在本地会话里单方面执行。

### M5.3 限流与数据清理（第三优先级）

**为什么**：BYOK 对匿名多访客开放后，两个此前不存在的问题变得真实：(a) 完全没有限流，任何人可以无限创建 conversation/run——模型调用成本是访客自己的 key 承担，但数据库写入量和并发 run 数是平台的；(b) 完全没有删除能力，现在连一个 `DELETE /api/conversations/:id` 接口都不存在，workspace/conversation/run 数据只会无限增长。

**设计要点**：
1. **限流**：引入 `@fastify/rate-limit`，按 `request.workspaceId`（比按 IP 更稳定，workspace cookie 本来就是既有的稳定标识）在 `POST /api/conversations/:id/runs` 上限流，具体阈值（例如"每分钟 N 次"）需要跟用户确认，不要单方面拍板。
2. **手动删除**：新增 `DELETE /api/conversations/:id`（校验 workspace 归属，未命中同现有 404 语义），级联删除该会话下的 runs/claims/reviews/candidates/votes/run_results/run_events。
3. **一个必须先补的 schema 缺口**：现有 `workspaces`/`conversations`/`runs`/`workspace_api_keys` 之间的外键都没有设置 `ON DELETE CASCADE`——这意味着即使做了删除接口，删除操作目前会直接因为外键约束报错。需要一个新迁移，把相关外键改成 `ON DELETE CASCADE`（比在应用层手写按依赖顺序删除更不容易漏删）。
4. **自动清理**：新增一个独立脚本（定位类似 `apps/api/src/db/migrate.ts`，例如 `apps/api/src/db/cleanup.ts`），删除 `workspaces.last_seen_at` 超过 N 天（默认天数需要跟用户确认）的 workspace 及其级联数据，通过 cron/systemd timer 定期跑，不挂在 API 请求路径上。

**验收标准**：删除接口有真实 DB 集成测试，确认级联删除后子表清空、且不影响其他 workspace 的数据；限流有测试模拟超阈值后返回 429；清理脚本有"给定 `last_seen_at` 早于阈值的 workspace，跑完后相关行都不存在"的测试。

### M5.3 限流与数据清理 — 实际结果（已完成，2026-07-05）

跟用户确认了两个原本标记"不要单方面拍板"的具体数字：限流阈值 **10 次/分钟**（按 workspace），过期清理阈值 **30 天**（`workspaces.last_seen_at`）。

- **迁移 `0006_cascade_deletes.sql`**：把 10 个外键（`conversations.workspace_id`、`runs.workspace_id`、`runs.conversation_id`、`workspace_api_keys.workspace_id`，以及 `run_events`/`claims`/`reviews`/`candidates`/`votes`/`run_results` 各自的 `run_id`）全部 drop+重建为 `on delete cascade`。约束名沿用 Postgres 默认命名（`<table>_<column>_fkey`），实现前先用 `pg_constraint` 查询过真实约束名，不是猜的。
- **`DELETE /api/conversations/:id`**：跟现有 `GET /api/conversations/:id` 用同一套 404 语义（未命中或不属于当前 workspace 一律 404，不用 403），成功返回 204。仓储层 `deleteConversation` 只删 `conversations` 一行，其余全靠 0006 的级联，没有在应用层手写按依赖顺序删除。
- **`deleteStaleWorkspaces` + `apps/api/src/db/cleanup.ts`**：跟 `db/migrate.ts` 同样的独立 CLI 脚本模式（`tsx src/db/cleanup.ts`，`db:cleanup` npm script），天数可用 `WORKSPACE_CLEANUP_DAYS` 环境变量覆盖默认的 30，供一次性用不同窗口跑一次，不用改代码。按设计只在 cron/systemd timer 里跑，不挂 API 请求路径。
- **限流的 key 生成没有按最初设想直接读 `request.workspaceId`**——`@fastify/rate-limit` 用 `global: false` 注册，只在 `POST /api/conversations/:id/runs` 这一条路由上通过 `config.rateLimit` opt-in；但 `request.workspaceId` 是 `runsRoutes` 自己的 `onRequest` 钩子设置的，跟限流插件的钩子谁先跑存在不确定性。改成直接读 `request.cookies[WORKSPACE_COOKIE_NAME]`（`@fastify/cookie` 在 app 顶层最早注册，一定先于任何路由钩子解析完 cookie），无 cookie 时退化到 `request.ip`——避免了钩子顺序的脆弱假设，效果一样（因为 workspace 本来就是靠这个 cookie 识别的）。
- **真实验证（2026-07-05，本地 Homebrew Postgres 16）**：
  - 全新建了一个真正空库跑 `db:migrate`，6 个迁移文件从零按序全部应用成功，`pg_constraint` 查询确认 10 个外键的 `confdeltype` 全部变成 `c`（cascade）。
  - `apps/api` 新增 5 个测试（全部打真实 DB）：级联删除测试用真实 `runDeliberation`（`MockProvider`）产出一个完整结果（claims/reviews/candidates/votes/run_results）+ 一条 `run_events`，delete 后逐表验证清空，且用第二个独立 workspace/conversation/run 验证级联没有越界删除别人的数据；`deleteStaleWorkspaces` 测试手动把一个 workspace 的 `last_seen_at` 改到 45 天前，跟一个"新鲜"的 workspace 对照，确认只删该删的那个；HTTP 层测试覆盖 `DELETE` 的 204/跨 workspace 404，以及限流测试连发 11 个真实建 run 请求确认第 11 个返回 429、且另一个 workspace 不受影响（并在测试结束前把所有真正建成的 run 轮询到终态，避免残留的异步 mock 编排任务在下一个测试的 `truncateAll` 时产生竞态——这个坑首次实现时确实撞见过，`afterEach` 的 `db.destroy()` 跟仍在跑的编排任务打架，报了几行 "driver has already been destroyed"，测试本身没失败但日志很吵，收紧测试后消失）。
  - 全 workspace（8 个包）`npm run build`/`npm run test` 均通过，`apps/api` 从 53 个测试增加到 58 个，全 workspace 从 214 个增加到 219 个，零回归。
  - 额外手动冒烟测试 `npm run db:cleanup --workspace=apps/api` 这个真实 CLI 脚本本身（不只是测试里调用的仓储函数）：手动插入一条 `last_seen_at` 为 40 天前的 workspace 行，跑脚本后确认该行被删、脚本正确报告删除数量，且库里其余 workspace 不受影响。

### M5.4 部署文档/Dockerfile（第四优先级）

**为什么**：目前唯一验证过的运行方式是本地 `npm run dev`/`npm run start` + Homebrew Postgres。如果这个项目的目标是"能被别人用起来"而不是停留在自己电脑上，需要至少一条可复现的部署路径。

**设计要点**：
1. `apps/api/Dockerfile`：多阶段构建（build 阶段跑 `npm run build`，runtime 阶段只拷贝 `dist`/`node_modules`/`package.json`，跑 `node dist/main.js`）。
2. `apps/web/Dockerfile`：Next.js standalone 输出（`next.config.ts` 加 `output: "standalone"`）减小镜像体积。
3. 文档层面写清楚生产环境必须设置的环境变量清单（`DATABASE_URL`、`ENCRYPTION_KEY`、`PORT`、`API_BASE_URL`），以及 `ENCRYPTION_KEY`/`models.config.json` 在生产环境该怎么管理——不能是明文 `.env` 文件，至少提示使用部署平台自带的 secrets 管理。
4. 可选：一份具体的"部署到 xxx"教程（Railway/Fly.io/Render 任选一个作参考路径），而不是空泛地说"用 Docker"。

**验收标准**：本地 `docker build` + `docker run` 把两个镜像跑起来，走一遍"创建会话 → 加 BYOK key → 提交 run → 看到结果"的完整流程，确认容器化之后行为和 `npm run dev` 一致。

### M5.5 分享链接（第五优先级）

**为什么**：官方 M4 范围里最后一项，相对独立、不涉及安全/正确性风险，排最后做，甚至可以留到有真实用户反馈"需要分享"时再动手也不迟。

**设计要点**：
1. DB：给 `runs` 加一个可空的 `share_token`（唯一，用户点击"分享"时才生成，不是所有 run 默认都有）。
2. API：`POST /api/runs/:id/share`（生成/返回 token，需要 workspace 归属校验）；`GET /api/share/:token`（公开，不需要 workspace cookie，返回和 `GET /runs/:id/result` 相同的只读数据，但要过滤掉任何跟 workspace/BYOK key 相关的字段）。
3. UI：完成页加"分享"按钮，展示可复制的链接；新增一个公开的 `/share/[token]` 页面，只读展示最终答案+共识面板，不出现任何需要 workspace 身份的操作（比如继续追问）。
4. 可选：撤销分享（把 `share_token` 置空）。

**验收标准**：分享链接在没有 workspace cookie 的浏览器/无痕模式下能正常访问并显示正确内容；确认分享出去的数据不包含任何 BYOK key 或其他 workspace 的会话信息。

## 2. 技术栈落地说明（TypeScript/Node）

沿用原文档第 14 章的 repo 结构，仅做两处补充：

```text
.
├── apps
│   ├── web
│   ├── api
│   └── cli          # 新增：M1 CLI 原型入口
├── packages
│   ├── protocol      # zod schema + 共识分类函数（比例制），CLI 与 backend 共用
│   ├── model-adapters # OpenAI-compatible adapter + 超时/重试/quorum 包装
│   ├── prompts
│   └── shared
├── docs
│   ├── protocol.md   # M0 产出：六阶段 schema 说明 + quorum/quick mode/透明性规则
│   ├── architecture.md
│   └── product.md
├── scripts
│   └── run-local-deliberation.ts
└── README.md
```

- `packages/protocol`：M0 阶段的核心产出，六个阶段的 zod schema、共识分类纯函数、对应的单元测试。
- `packages/model-adapters`：封装 quorum/超时/重试逻辑，M1 CLI 和 M2 backend 共用同一份实现，避免两处维护两套降级策略。
- `apps/cli`：M1 里程碑的落地位置，读 `packages/protocol` 和 `packages/model-adapters`，跑通全流程并输出 JSON/Markdown 报告（含耗时/成本基线）。

## 3. 风险对照表

| 风险 | 修订项 | 落地位置 | 验收方式 |
|------|--------|----------|----------|
| 成本/延迟被低估 | 定义 p50/p95 延迟预算 + quick mode 具体路径 | M0 协议文档 | M1 实测数据对照基线 |
| Normalize 隐含裁判权 | 协议级要求保留 `source_claim_ids` + 界面必须可追溯 | M0 协议约束 → M3 UI 入口 | M1 输出可追溯性检查；M3 UI 走查 |
| 共识规则写死 3 模型 | 比例阈值替代硬编码计数 | M0 `packages/protocol` 分类函数 | 单元测试覆盖 3/5/7 模型场景 |
| 无失败/超时降级策略 | quorum 机制 + partial 标记 | M0 协议定义 → M1/M2 Model Adapter 实现 | M1 构造超时场景验证不崩溃 |
| claims 主键未隔离 | 复合键 `(run_id, claim_id)` | M0 schema 定稿 → M2 DDL | 跨 run 插入相同 local id 不冲突 |

## 4. 下一步

M0、M1、M1.5、v0.2、M2、M3、M4（BYOK 平台）均已完成并通过真实验证（BYOK 见上方"M4 第一阶段补充"一节的实测数据），M4 到此结束。M5 按优先级排序为**成本熔断 → CI → 限流/数据清理 → 部署文档 → 分享链接**；其中 **M5.1 成本熔断已完成**（见上方"M5.1 成本熔断 — 实际结果"一节），下一步是 **M5.2 CI**。

其他已知的、不阻塞 M5.2 但值得记录的后续待办：
- M5.1 的计价策略还没有用真实模型调用验证过准确性（沙盒里没有可用的真实 BYOK key）——接入真实模型后第一件事应该是核对 OpenRouter 的 `usage.cost` 和 OpenAI/Volcengine 的 blended 汇率近似值分别与真实账单差多少。
- BYOK 完全自定义 baseUrl（需要内网地址过滤、DNS rebinding 防护、重定向校验、IP 编码解析等 SSRF 加固）、Anthropic/Google 专用 adapter、加密密钥轮换机制——见上方"M4 第一阶段补充"一节（其中"删除已保存 key 的接口"已经并入 M5.3 的删除能力一起做）。
- `STANDARD_BUDGET`/`PLANNING_BUDGET` 的 p50/p95 目标数字还是 M0 阶段凭空猜的，需要用已经收集到的真实耗时数据回填；M3 的前端预估耗时文案已经改用真实基线数字，但协议层的常量本身还没回填。
- disputed 分类路径已经在 planning 模式的真实数据里被触发过一次（后端技术栈选型的 Java vs Node.js 分歧，见上文 v0.2 一节），且是跨厂商组合下出现的，同厂商组合没出现过。目前的结论：**问题的抽象层级比模型组合更重要**——宽泛的主观辩论（996、球星之争）即使换了跨厂商模型也趋向收敛，但具体到有明确技术权衡的实现细节（该用哪个框架/工具），模型之间确实会产生有论据支撑的真实分歧。
- M2 的一个已知限制：API 进程在 run 执行中途重启会让该 run 永久卡在 `running` 状态（见上方"M2 补充"一节）。真正的跨重启可恢复性留到有实际需求时再做。
- M2 刻意没有引入 Redis（单进程内存 SSE 广播器 + Postgres 已够用），如果未来需要多实例部署 `apps/api`，事件广播需要改成跨进程方案（Redis pub/sub 或等价机制），这会是那时候的前置工作，不是现在的技术债。
- ~~planning 模式"所有 topic 全部失败"时 orchestrator 从不发出终止 SSE 事件的缺口~~——已在 M5.1 里顺带修掉（成本熔断让这个场景从"多模型同时宕机的边缘情况"变成了会真实发生的路径，见上方"M5.1 成本熔断 — 实际结果"一节）。
- planning 模式实时进度里，每个 topic 在 outline 完成之前只能显示 model 自己起的 `topic_id`（如 `"3"`），没有可读标题——要等整个 run 跑完、`GET /result` 的 `outline.topics` 返回后才知道标题。如果想在运行过程中就显示可读标题，需要给 outline 的 `phase_completed` 事件补上 topics 列表（目前只带了 `count`），这是后端的小改动，不在 M3 范围内。
