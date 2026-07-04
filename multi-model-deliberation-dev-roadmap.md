# 多模型协商式对话产品：改进版开发流程

日期：2026-07-03（最后更新 2026-07-04）
配套文档：[multi-model-deliberation-tech-design.md](/Users/xyz91928/Documents/Codex/2026-07-03/yo/outputs/multi-model-deliberation-tech-design.md)、[docs/protocol.md](docs/protocol.md)

## 当前进度

| 阶段 | 状态 | 说明 |
|------|------|------|
| M0 协议加固 | ✅ 完成 | `packages/protocol`，五个风险点全部落地为 schema/纯函数约束 |
| M1 CLI 原型 | ✅ 完成 | `apps/cli`，mock provider 和真实 OpenAI 兼容 API 都跑通过 |
| M1.5 收敛验证关卡 | ✅ 完成，Go 决策 | 见下方"M1.5 实际结果" |
| v0.2 Planning Mode（长输出支持） | ✅ 完成 | 不在原路线图里，M1.5 之后新增，见下方专门一节 |
| M2 Backend API | 待开始 | 下一步 |
| M3 Web MVP | 未开始 | |
| M4 产品化基础 | 未开始 | |

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

### M2：Backend API（同原文档，落实 M0 的约束）

- Conversation / Run API、SSE 事件流、Postgres 持久化、错误重试——同原文档。
- Model Adapter 必须实现 M0 定义的 quorum / 超时 / 重试策略，不是简单的 `Promise.all`。
- Persistence 层的 claims/reviews/votes 表用 M0 修正后的复合键 schema（`run_id` + 本地 id），不要照抄原文档第 7 章未修正的 DDL。

### M3：Web MVP（同原文档，新增透明性和预估展示）

- 问题输入、模型选择、运行进度、讨论过程折叠展示、最终答案和共识面板——同原文档。
- 新增：候选共识（candidate claim）旁边有入口可展开查看合并前的原始 claims（对应 M0 的透明性兜底）。
- 新增：运行前展示预估耗时和预估成本（基于 M1 的基线数据 + 选择的模型数/轮次）。

### M4：产品化基础（同原文档，新增成本熔断）

- 用户账号、API key 管理或平台额度、成本估算、历史会话、分享链接——同原文档。
- 新增：quick mode 开关（对应 M0 定义的具体降级路径，而不是模糊的"quick mode"）。
- 新增：单次 run 的成本上限熔断——超过预算时提前终止并提示用户，而不是等跑完才发现超支。

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

M0、M1、M1.5 均已完成并给出 Go 决策，v0.2 Planning Mode 作为额外能力也已上线并通过真实测试。下一步是 M2 Backend API：Conversation/Run API、SSE 事件流、Postgres 持久化，把 `apps/cli` 里已经验证过的 orchestrator 逻辑搬到服务端。

其他已知的、不阻塞 M2 但值得记录的后续待办：
- `STANDARD_BUDGET`/`PLANNING_BUDGET` 的 p50/p95 目标数字还是 M0 阶段凭空猜的，需要用已经收集到的真实耗时数据回填。
- disputed 分类路径已经在 planning 模式的真实数据里被触发过一次（后端技术栈选型的 Java vs Node.js 分歧，见上文 v0.2 一节），且是跨厂商组合下出现的，同厂商组合没出现过。目前的结论：**问题的抽象层级比模型组合更重要**——宽泛的主观辩论（996、球星之争）即使换了跨厂商模型也趋向收敛，但具体到有明确技术权衡的实现细节（该用哪个框架/工具），模型之间确实会产生有论据支撑的真实分歧。这对 M2/M3 有产品含义：protocol 的核心价值在处理"综合技术规划"这类细节丰富的长输出时更容易体现出来，而不是"两个模型吵架"这种粗粒度的宽泛问题。
