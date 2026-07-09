# MMD 与 OpenRouter Fusion / LiteLLM 的全面对齐报告

日期：2026-07-09（资料访问日）<br>
状态：**历史研究归档，不是当前路线或行为规范。** 当前权威开发路径见 [统一开发路径](../../development.md)，当前实现契约见 [架构与运行参考](../../architecture.md)。<br>
范围：当日 MMD 工作树，不把设计文档中的目标当作已交付能力。Fusion 的对照基线为其公开文档中的可观察行为，而非不可见的内部实现。来源、访问日期与证据限制见本文末尾附录。

## 结论先行

**MMD 目前尚未达到 OpenRouter Fusion 级别。**

更精确地说：MMD 已是一个经过 Python/Proxy/真实模型冒烟验证的
LiteLLM *外部 custom provider 原型*，并且其 `standard` / `planning`
协议在可审计的多模型整合上比 Fusion 的“panel + judge”更深；但它还未
达到 Fusion 的产品级可用性，也尚不具备适合直接合入 LiteLLM 内核的
接口完整度。

造成结论为“未达到”的决定性差距有四项：

1. **入口决策不同。** Fusion 由外层模型决定是否调用 deliberation，且可强制；MMD 每次请求都会直接运行 `quick`，没有外层模型、工具注入或按需路由。
2. **默认配置不同。** Fusion 不传 panel 也能使用质量预设；MMD 强制调用方提供 `analysis_models`，其 `cheap` / `balanced` / `strong` 只限制已提供列表的长度和超时。
3. **工具/联网不等价。** Fusion 的 panel 和 judge 均有可执行的 web-search / web-fetch 循环。MMD 目前只把 `tools` 参数透传给底层模型，不消费 tool calls、执行工具或把结果回灌；真实烟测也未覆盖工具。
4. **LiteLLM custom-provider 契约不完整。** LiteLLM 的 `CustomLLM` 会按同步/异步和 `stream` 分派至四个方法；MMD 只实现了 `completion` / `acompletion`。此外它只抽取最后一条 user 文本，且用一次 `litellm.completion(..., mock_response=...)` 再包装结果，而不是填充 LiteLLM 传入的 `ModelResponse`。

因此建议是：**先把 MMD 作为独立的 `mmd-litellm` 包发布和验证；向 LiteLLM 先发一个小而中立的 design Issue，而不是立刻提交一个把 MMD 整体塞进 LiteLLM 的大 PR。** 维护者认可扩展点与维护边界后，再按下面的分阶段 PR 方案推进。

## 1. 对照对象：Fusion 的“级别”到底是什么

Fusion 是 `openrouter/fusion` 模型别名或显式 server tool：外层模型可自行决定是否调用；被调用后，1–8 个 panel 模型并行回答，judge 返回结构化的 consensus、contradictions、coverage、unique insights 与 blind spots，再由外层模型完成最终回复。panel 与 judge 都可调用 OpenRouter 托管的 web search/fetch；默认质量预设可免配置使用；默认 3 panel 时成本约为单次请求的 4–5 倍，并以深度 header 阻止递归。见 [Fusion Router 文档](https://openrouter.ai/docs/guides/routing/routers/fusion-router)。

这一定义刻意同时包含“多模型算法”和“可用产品表面”。只比较 panel 是否并行，会高估 MMD 的对齐程度；只比较协议是否多轮，又会低估它在治理上的差异化。

## 2. 能力对齐矩阵

| 维度 | Fusion 基线 | MMD 当前证据 | 结论 |
| --- | --- | --- | --- |
| 普通 Chat 入口 | `openrouter/fusion` 可像模型调用 | `mmd/fusion` custom provider、Proxy 配置及 OpenAI-format response 已有测试 | **部分达到** |
| 按需 deliberation | 外层模型决定，`tool_choice: required` 可强制 | 直接执行 `run_deliberation`；无外层决策层 | **未达到** |
| 默认可用 | 可省略 panel，采用 Quality preset | `analysis_models` 为必填；preset 不选择模型 | **未达到** |
| panel 并发与规模 | 并发 panel，1–8 | fan-out；`max_analysis_models` 1–8，且已有 quorum | **达到（机制）** |
| 结构化整合 | judge 输出共识、冲突、缺口、独见 | quick 的 normalize/compose；standard 另有 critique/revise/vote；`return_analysis` 有同类摘要 | **达到且审计维度更强** |
| 最终回答责任 | 外层模型依据 judge analysis 写答案 | coordinator 直接 compose，用户的原对话上下文不由外层模型续写 | **部分达到** |
| 工具与最新网页信息 | panel/judge 有受限的 server-tool loop | 仅参数透传；无 MMD tool execution loop；无真实工具测试 | **未达到** |
| 成本、时限、调用控制 | panel 成本透明，内层 token/tool 限制 | 聚合 token usage、每模型/总运行超时、总调用数；没有价格估算或全局工具调用计数 | **部分达到** |
| 弹性与递归 | 单层 Fusion 深度保护 | quorum/partial、Router 可注入、`mmd_deliberation_depth` 保护 | **达到（不同机制）** |
| 审计和观测 | generation router metadata | opt-in trace / analysis / callback payload、claims/votes/failures/usage | **达到，且是主要优势** |
| OpenAI / LiteLLM 兼容性 | 托管服务覆盖其 API 表面 | non-streaming 路径可用；无 stream/astream、消息缩减、tool calls 不能端到端 | **未达到** |
| 真实运行证据 | 托管产品 | 用户提供的 OpenRouter 配置完成核心冒烟；日志未保留 usage/latency JSON；未覆盖 tools/stream | **部分验证** |

本矩阵的关键反直觉点是：**MMD 在“协议严谨性”上可以高于 Fusion，但仍可能在用户眼中低于 Fusion。** 用户首先感知的是零配置、自动判断、流式响应、联网和稳定成本边界，而不是内部多一轮 vote。把审计协议直接暴露为默认交互，反而会损失 Fusion 已证明的低摩擦价值。

## 3. MMD 当前实现的真实位置

### 已实现且有自动化验证

- `MMDLiteLLMProvider(CustomLLM)` 接收 LiteLLM 请求并执行 `quick`、`standard`、`planning`；内部调用可经注入的 LiteLLM Router 或 `litellm.acompletion` 到模型。
- 以 panel fan-out、quorum、partial failure、结构化 repair、normalize、vote/classification 与 compose 形成多模型协议；`standard` 的 propose → critique → revise → normalize → vote → compose 比 Fusion 的单次 panel/judge 多出可审计交互。
- `return_trace`、`return_analysis`、聚合 token usage、限量 callback trace、总 wall-clock timeout 与总调用次数预算均已存在；异常在安装 LiteLLM 时映射到其原生异常类型。
- 本次复验通过：Python `69 passed`、TypeScript `102 passed`、根构建与 Python sdist/wheel 构建均成功。

### 已实现但不能当作 Fusion 完整对齐

- `tools` / `tool_choice` / `max_tool_calls` 会进入 panel（coordinator 需显式开启），但这只是底层参数传递。若模型返回 function call，`LiteLLMCompletionClient._extract_content()` 只取文本；没有工具执行与下一轮模型调用。因此它不能对标 Fusion 的网页工具链，也不能声称通用 tool calling 支持。
- `preset` 目前只设置 `max_analysis_models` 与 `per_model_timeout`，不会根据可用 provider key 或模型能力形成 Quality/Budget panel。文档中“Fusion parity config”应保留为路线，不应表述为已完成的 default preset。
- token usage 可合计，但没有可靠的多模型总成本、预算预估、模型价格快照或面向 key/team 的 cost attribution。LiteLLM 自身已提供路由、重试、cooldown、fallback 和生产 Redis 状态；MMD 应尽量复用而非复制这些职责。[LiteLLM Router 文档](https://docs.litellm.ai/docs/routing)

### 上游前必须修复的兼容性缺口

1. **完整消息保真。** 现在只读取最后一个 `role=user` 的文本，忽略 system/developer、历史 assistant、tool messages、图文 content parts。应定义并测试一个 canonical conversation-to-deliberation prompt，而非悄然丢弃上下文。
2. **streaming。** LiteLLM 的 custom dispatcher 在 `stream=True` 时调用 `streaming` / `astreaming`；MMD 未实现，所以会落入基类的 500。至少应实现“先 deliberation、再按 OpenAI chunk 流式输出最终答案”的 honest streaming，并在 metadata 标注 `deliberation_complete_before_first_token=true`；更理想的是送出阶段事件，但那是新协议，不应伪装成 token stream。[LiteLLM custom handler 源码](https://github.com/BerriAI/litellm/blob/main/litellm/llms/custom_llm.py)
3. **正确使用 `ModelResponse`。** LiteLLM 传给 custom handler `model_response` 与 `logging_obj`；MMD 的宽松 `*args, **kwargs` 虽能调用，但又发起 mock completion 来构造 response。这可能引入嵌套 callback、错误 model 语义或版本脆弱性。应采用明确签名并填充传入 `ModelResponse`，再以代理端到端测试断言 callbacks 仅一次。
4. **工具能力的诚实边界。** 短期应在请求含 tools 时返回清晰 400（或提供 `tool_mode=passthrough_text_only` 的显式实验特性），而不是让调用方以为已支持。长期要么实现受限 tool loop/adapter，要么以 LiteLLM 既有 provider tool semantics 为唯一执行者并留存结果 trace。
5. **运行预算。** `max_total_calls` 目前限制模型调用，不能限制 provider 内部 tool steps。应改名为 `max_model_calls`，另引入全局 `max_tool_calls` / `max_total_tool_calls`，使语义可审计。

## 4. LiteLLM 架构与社区约束：对 MMD 的含义

LiteLLM 是统一 SDK / Proxy / Router / provider-adapter / observability 的 gateway：Router 做 model group/deployment 的负载均衡、失败重试、fallback、cooldown、timeout 与可选 Redis usage 状态；Proxy 处理 OpenAI-compatible HTTP、密钥与治理；provider 实现负责将请求转换并返回规范化 response。[Router 文档](https://docs.litellm.ai/docs/routing) 与 [项目仓库](https://github.com/BerriAI/litellm) 均支持这一分层。

MMD 放在其中应是：

```text
OpenAI client
  → LiteLLM SDK / Proxy（auth、budget、callbacks、HTTP）
  → mmd custom provider（请求/响应契约）
  → MMD strategy engine（deliberation 与审计）
  → LiteLLM Router（每个 panel/coordinator 的部署选择、fallback）
  → 各模型 provider
  → ModelResponse + LiteLLM callbacks / optional MMD trace
```

这意味着 MMD **不应重做 Router、虚拟 key、成本表或 callback 调度**；它只应表达“何时、对哪些 model group、以何策略做多模型协商”。callback 方面，当前将 opt-in payload 附到请求级 `logging_obj.model_call_details["mmd"]`、避免自行遍历全局 callback 的方向是对的：LiteLLM 提供同步/异步 success/failure hooks，并建议异步 I/O 使用 `CustomLogger`。[Custom callbacks 文档](https://docs.litellm.ai/docs/observability/custom_callback)

社区层面，LiteLLM 要求 CLA、Conventional Commits/branches、每个 PR 至少一个测试；其主贡献指南要求 `make format`、`make lint`、`make test-unit`，且明确欢迎新 provider。见 [CONTRIBUTING.md](https://raw.githubusercontent.com/BerriAI/litellm/main/CONTRIBUTING.md)。这不等于一个大“Fusion replacement”必会被接受：它仍应是单问题、可维护、可测试、不会把产品策略强耦合到 gateway 内核的提交。

## 5. 向 LiteLLM 提交的推荐路线

### 不建议立即提交的内容

- 不提交把 `quick` / `standard` / `planning`、所有 schemas、prompt 和审计协议一次性迁入 LiteLLM 的巨型 PR。
- 不声称“比 Fusion 更强”或以未测的工具能力作为卖点；用“external, self-hosted multi-model deliberation provider”描述即可。
- 不在 LiteLLM 单测中使用任何真实 API key，或把用户的 `.env` / 模型配置提交到仓库。
- 不重复提交“custom handler 路径难以加载”的旧问题；先核验现行 entry-point 机制与 [#7733 的已完成历史](https://github.com/BerriAI/litellm/issues/7733)。

### Phase 0 — MMD 自仓库的 upstream-readiness gate（先完成）

完成以下项目，才值得请求 LiteLLM 维护者评审集成方向：

1. 明确实现 `completion` / `acompletion` / `streaming` / `astreaming`，使用 LiteLLM 当前方法签名和传入的 `ModelResponse`。
2. 建立消息兼容矩阵：system、developer、multi-turn、tool-result、content parts、`stream=True`、`tools`。不支持的类型必须 fail-fast，并有测试。
3. 增加 Proxy e2e 测试：response shape、stream chunks、一次 callback、native error mapping、Router alias/fallback、递归保护、total model/tool budget。
4. 增加可选的、默认跳过的真实 provider test：从环境变量读 key，保存脱敏的 model ids、duration、usage、phase/quorum，不保存 prompt/secret；把工具真实路径单独覆盖。
5. 发布一个可安装的预发布包与最小示例。现有 wheel 已能构建，但应消除对配置目录 `mmd_handler.py` shim 的部署依赖，或把它作为明确记录的兼容层。

### Phase 1 — 先发 design Issue（推荐，英文可直接使用）

标题：`Proposal: guidance for external multi-model orchestration providers built on CustomLLM`

正文：

> ## Problem
> LiteLLM's `CustomLLM` interface makes it possible to implement a virtual model that fans out to multiple LiteLLM model groups and returns one OpenAI-compatible completion. The current custom-provider material is excellent for a single remote backend, but it does not state recommended semantics for orchestration providers: preserving a full chat conversation, streaming after aggregation, accounting for nested calls, recursion guards, and adding bounded audit metadata without duplicating callbacks.
>
> ## Proposal
> Could maintainers confirm whether a small documentation/example contribution covering these provider-agnostic practices would be welcome? It would not add a deliberation algorithm or a first-party provider. It would document: (1) `ModelResponse` and all four custom-handler methods; (2) parent/child metadata and recursion boundaries; (3) callback-safe request-scoped metadata; (4) test cases for Proxy + Router + stream; and (5) secret-free integration-test guidance.
>
> ## Motivation and scope
> This is useful for self-hosted multi-model orchestration packages, while keeping LiteLLM responsible for routing, auth, governance and observability. I have an external proof of concept and will keep it outside the LiteLLM repository unless maintainers prefer otherwise. Before opening a PR, I would like agreement on the desired extension boundary and whether an existing entry-point mechanism already covers package registration.
>
> ## Non-goals
> No hosted-service integration, no new router algorithm, no model pricing changes, no changes to the proxy request schema, and no real API keys in tests.

提交前在 Issue 模板中如实勾选“已搜索重复 issue”，并补一个最小可复现仓库/脱敏 gist；避免贴整套 MMD 代码。目标是拿到维护者对**文档贡献**或**潜在 generic hook**的明确反馈。

### Phase 2 — 第一份 LiteLLM PR（仅在 Issue 获得认可后）

**首选 PR：文档 + secret-free 示例，零核心行为变更。**

- 仅改 custom-provider 文档和一个很小的 test/example。
- 演示一个抽象 `orchestrator` provider：按完整会话调用两个配置好的 LiteLLM aliases，填充传入 `ModelResponse`，正确实现 async streaming，给 `logging_obj` 附小型父级 metadata。
- 测试覆盖一个 async non-stream、一个 `stream=True`、一个 callback 不重复的情形。不要在示例中引入 MMD 的 vote schemas 或任何品牌主张。
- Commit/branch 例：`docs(custom-provider): document orchestration provider lifecycle`。

这份 PR 的价值是降低所有外部编排包的集成风险，符合 LiteLLM 作为 gateway 的边界，也满足“一件事、一组测试”的社区习惯。

### Phase 3 — 条件性代码 PR（只在维护者明确需要时）

若 Phase 1/2 的反馈是“可提供 generic extension”，再提一个独立的小 PR，而不是 `mmd` built-in provider：

- 候选功能：一个稳定的 parent-call metadata / child-call depth helper，或 custom-provider 的官方 package-registration adapter（仅在核实现有 entry points 后确认仍有缺口）。
- 验收：不改变现有 provider 的默认路径；不依赖 MMD；有 unit + Proxy test；有 migration/compatibility note。
- 只有当维护者要求 first-party integration 时，才设计 `mmd` provider PR；届时应把 MMD 固定为外部依赖或 opt-in extra，且先完成 Phase 0。

## 6. 发布门槛与成功度量

在说“Fusion-level”前，建议满足以下可验收条件：

- 省略模型列表时有可解释、可配置、provider-aware 的 default panel，或明确提供单一 `mmd` 配置对象而非多个散参数。
- `auto` / `required` / `off` 三种 deliberation policy，其中 `auto` 有可测试的决策逻辑而不是文案。
- 完整 OpenAI chat turn 保真；`stream=True` 可用；tools 要么端到端可用，要么明确拒绝。
- 真实三模型测试覆盖 quick、standard、planning、partial quorum、timeout、budget、stream、至少一个 tool/web path；每次输出脱敏评估 artifact。
- 每次运行提供按 panel/coordinator 的 token、估算成本、延迟、成功率及 partial 状态；用这些数据比较单模型、Fusion 和 MMD，而不是声称协议必然更好。
- 至少一个外部用户在独立 LiteLLM Proxy 部署中复现安装与运行。

质量上还应做基准而非直觉判断：选 30–50 个带事实核验和主观权衡的任务，固定模型版本/温度/预算，比较单模型、Fusion、MMD quick、MMD standard 的正确率、引用可核验率、拒答/失败率、p50/p95 latency、总 token/cost 和人工偏好。MMD 的多轮投票可能提高审计透明度，也可能因同源模型或错误共识放大偏差；只有该基准能验证其“更可信”的主张。

## 7. 自审

- [x] 结论同时覆盖集成程度、功能程度、LiteLLM 架构和社区规范。
- [x] 所有外部事实均可回溯到 `sources.md` 中的官方文档/仓库或标注为本地代码证据。
- [x] 未把“代码存在”误写成“真实路径已验证”，也没有输出用户提供配置中的 secret。
- [x] 给出了两个视角：MMD 的审计协议优势，以及 Fusion 的低摩擦产品优势。
- [x] PR/Issue 方案先缩小范围、再请求维护者意见，并包含非目标与测试门槛。
- [x] 主要不确定性已保留：真实运行日志未持久化、工具/stream 未测、LiteLLM main 分支接口随版本可能变化。

## 附录：来源台账

访问日期：2026-07-09。Web 文档为持续更新的文档，除非明确写明发布日期，否则仅记录访问日。

| 来源 | 用途与限制 |
| --- | --- |
| [OpenRouter Fusion Router docs](https://openrouter.ai/docs/guides/routing/routers/fusion-router) | Fusion alias/server tool、外层模型按需调用、1–8 panel、judge、web tool、成本和递归语义。产品文档，不是私有实现或 benchmark。 |
| [OpenRouter Fusion API page](https://openrouter.ai/openrouter/fusion/api) | Quality/Budget 的产品级描述。 |
| [OpenRouter Web Search server tool](https://openrouter.ai/docs/guides/features/server-tools/web-search) | 模型控制的多步搜索、上限与 beta 状态。特定于 OpenRouter 托管服务。 |
| [LiteLLM Router docs](https://docs.litellm.ai/docs/routing) | aliases、路由、fallback、cooldown、timeout、retry 和 Redis production state。接口会随 release 改变。 |
| [LiteLLM Custom Provider docs](https://berriai-litellm.mintlify.app/advanced/custom-providers) | `CustomLLM`、`ModelResponse`、Proxy 注册、streaming/async 与测试实践。该页面是官方文档镜像。 |
| [LiteLLM custom callbacks docs](https://docs.litellm.ai/docs/observability/custom_callback) | callback 生命周期与 request metadata。 |
| [LiteLLM repository](https://github.com/BerriAI/litellm) 与 [CONTRIBUTING.md](https://raw.githubusercontent.com/BerriAI/litellm/main/CONTRIBUTING.md) | gateway 分层、CLA、单问题 scope、测试和 lint 规范。以 main 分支当日状态为准。 |
| [LiteLLM `custom_llm.py`](https://github.com/BerriAI/litellm/blob/main/litellm/llms/custom_llm.py) | custom provider 的四个 completion/streaming 分派路径。主分支接口需要在实际 PR 前重新 pin/核验。 |
| 本地 `python/mmd_litellm/{litellm_provider,orchestrator,client}.py`、`python/scripts/proxy_real_smoke.py` 和测试 | 当前实现、测试和 smoke harness 的静态/本地执行证据；不证明第三方 provider 的长期生产行为。 |

证据规则：本地测试实际断言的功能才标为“验证”；只有代码存在的功能只能标为“已实现、未在真实 provider 路径验证”；文档中的目标不视为已交付。
