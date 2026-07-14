# MMD 统一开发路径

本文件是 MMD 唯一的开发路线、状态和验收标准来源。新增功能、文档、Issue 和 PR 必须更新这里；不得另建平行 roadmap、集成转向说明或主线计划。实现细节见 [架构与运行参考](architecture.md)。

## 产品方向

MMD 的目标是 LiteLLM 生态中的开源、自托管、多模型 deliberation provider：对调用方表现为普通 chat completion，对内部调用多个 LiteLLM model groups，并保留可审计的 consensus / disagreement / source trace。

它不以“比单模型必然更聪明”为承诺。其可验证价值是：降低单一回答的偶然性、暴露分歧、让结论可回溯，并在 quorum 满足时继续处理部分模型失败。LiteLLM 负责 gateway、路由、鉴权、fallback、预算和 observability；MMD 只负责协商策略。

## 已完成的路径

| 阶段 | 状态 | 产物与结论 |
| --- | --- | --- |
| M0 协议加固 | 完成 | 比例制共识、run-scoped id、quorum、结构化修复和预算约束在 TypeScript schema/纯函数落地。 |
| M1 CLI 原型 | 完成 | mock 与真实 OpenAI-compatible 模型均可运行 `quick` / `standard`。 |
| M1.5 收敛验证 | 完成 | 真实任务证明多模型协商值得继续验证；不将其误述为通用质量结论。 |
| v0.2 Planning | 完成 | Outline + 每 topic 并行 standard deliberation + deterministic executive summary。 |
| M2' LiteLLM provider 核心 | 完成第一版 | Python/Pydantic `mmd/fusion`、Proxy、Router 注入、usage、trace/callback、异常、timeout/call budget、wheel 和 smoke。 |
| 原 M3 Web / M4 自建产品化 | 暂停 | 降级为未来 trace viewer / demo；不与 LiteLLM gateway 重复建设。 |

目前的验证基线：Python 212 tests（`litellm[proxy]` 安装时；含 10 个真实 Proxy 子进程 e2e test；未安装时为 197 tests + 15 个自动 skip）、TypeScript 102 tests，各自构建通过；scripted Proxy smoke 和核心真实模型 smoke 已运行。真实 smoke 未保存质量、成本或 latency artifact，不能作为性能或效果基准。

## 当前工作：M2' upstream-readiness

M2' 的目标不是匆忙把 MMD 并入 LiteLLM，而是先形成可独立安装、可验证、符合 LiteLLM custom-provider 契约的外部包。按以下顺序推进，前一项未达到验收时不跳到后一项。

### P0 — 补齐 LiteLLM provider 契约

**目标**：使 `mmd-litellm` 成为可靠的 external custom provider。

**工作项**：

1. ✅ 已完成。显式实现 `completion`、`acompletion`，使用 LiteLLM 当前签名与传入的 `ModelResponse`；去除了以 `mock_response` 二次构造 response 的路径（`mmd_litellm/litellm_provider.py` 的 `_finalize_response`/`_populate_model_response`）。
2. ✅ 已完成。新增 conversation adapter（`mmd_litellm/conversation.py`），保留 system/developer、多轮 assistant、tool result 和 text content parts 作为 deliberation 的背景 context；不支持的 multimodal content part（如 `image_url`）会 fail-fast 抛出 400，不再静默丢弃。
3. ✅ 已完成。实现了 `streaming`/`astreaming`：先完整跑完 deliberation，再把最终答案按 ~40 字符词边界切块，通过 `GenericStreamingChunk` 逐块返回；`mmd`/`mmd_analysis` 通过终块的 `provider_specific_fields` 暴露。**已验证的 LiteLLM 行为，非 MMD 特有**：调用方必须在请求里设置 `stream_options.include_usage=true` 才能在流中收到 `usage`（标准 OpenAI/LiteLLM 语义，LiteLLM 默认丢弃 usage）。阶段/进度事件仍未实现，保持推迟；这是唯一未做的子项。
4. ✅ 已完成。对 tools 做了产品决策：默认 `tool_mode="reject"`，请求携带 `tools`/非空 `tool_choice` 时返回 400；调用方可显式设置 `tool_mode="experimental_passthrough"` 退回到透传行为，响应会在 `mmd.tooling.experimental` 中标注。此前推迟的"`max_total_calls` 更名/补充全局 tool budget"已在 P1"工具/联网"落地时解决——见下方 P1 表格该行的说明。
5. ✅ 已完成。新增 Proxy e2e pytest（`python/tests/test_proxy_e2e.py` + `python/tests/conftest.py`），真实启动 `litellm` Proxy 子进程覆盖：normal、stream（含 usage/trace frame 断言）、callback 仅一次、Router alias、native error 4xx 契约、recursion guard、call budget、timeout，共 8 个场景；`litellm[proxy]` 未安装时自动 skip。**已验证的 LiteLLM 行为，写测试前务必确认**：(a) 用 `litellm_settings.callbacks`（而非 `success_callback`）注册 `CustomLogger` 实例——`success_callback` 的自动 async/sync 路由对纯对象实例误判为同步回调，导致 async 回调永远不会触发；(b) client 可见的 JSON 错误体（`ProxyException.to_dict()`）只含 `{message, type, param, code}`，`code` 是 HTTP 状态码字符串，MMD 自身的 `mmd_bad_request` 等 code 不会出现在响应体里，断言只能用状态码 + message 子串。

**验收**：所有支持路径具有 unit + Proxy test；所有不支持路径给出稳定的 4xx 错误；示例可在干净环境只通过安装包和 shim 启动。P0 五项已全部完成并通过验证；下一阶段进入 P1。

### P1 — Fusion 级可用性差距

Fusion 是产品对照，不是应复制的私有实现。达到“Fusion-like”之前必须完成下列能力或清晰标明不支持：

| 缺口 | 目标验收 |
| --- | --- |
| 默认 panel | ✅ 已完成。基于 LiteLLM Router 内省的 provider-aware 默认 panel；不硬编码用户 key 或厂商模型。 |
| deliberation policy | ✅ 已完成。`off`、`required`、`auto`；`auto` 必须有可测试的决策机制。 |
| 工具/联网 | ✅ 已完成。MMD 自己执行的单一 `web_fetch` 工具，带全局调用上限、result trace 和真实集成测试。 |
| 成本/性能 | ✅ 已完成。每个 panel/coordinator 的 tokens、估算成本、duration、成功率和 partial 状态。 |
| 兼容性 | ✅ 已完成。完整 chat turn、streaming、明确 tools 语义和稳定 response/metadata version。 |

**deliberation policy（已完成）**：新增 `deliberation_policy: off/required/auto`（默认 `required`，与既有行为完全一致，不影响任何现有调用方）。`off` 用 `coordinator_model`（缺省第一个 panel model）直接单次问答，跳过整个 fan-out/critique/vote 流程，但仍计入 `max_total_calls`/`max_run_timeout` 预算，并且不绕过既有的 `tool_mode="reject"` 400 校验。`auto` 用确定性、零额外模型调用的启发式（问题字数阈值 + 决策/判断类关键词匹配，`mmd_litellm/policy.py::decide_auto_deliberation`）决定是否协商——选择启发式而非 LLM 分类调用，是因为验收只要求“可测试”，纯函数无需 mock/重试/预算即可确定性测试两个分支，且不会给每次请求都加一次分类调用的延迟和成本。决策记录在 `return_trace` 响应的 `mmd.policy`（`policy`/`deliberated`/`reason`/`auto_signals`）。

**成本/性能（已完成）**：`UsageEvent` 新增 `role`（`panel`/`coordinator`，按 phase 是否属于 fan-out 阶段判定）、`duration_seconds`（`UsageCollectingClient` 用 `time.monotonic()` 包住每次调用测得）、`cost_usd`/`cost_unavailable`。成本估算优先复用 LiteLLM 自己已经算好的数字——`mmd_litellm/client.py::_extract_cost` 从真实 LiteLLM 响应的 `_hidden_params["response_cost"]` 直接读取（与 `litellm.cost_per_token` 内部用的是同一张定价表，避免重复计算、避免与 LiteLLM 实际计费产生分歧）；只有拿不到真实 response（例如测试用的假 client）时才退回到 `mmd_litellm/cost.py::estimate_call_cost` 独立调用 `litellm.cost_per_token()`。LiteLLM 未安装、usage 缺失、或模型不在其定价表里（如所有测试用的假 model id）时，`cost_unavailable=True`，不阻断请求，`mmd_analysis.limitations` 会补一行说明。新增 `RolePerformance`/`PerformanceSummary`（`panel`/`coordinator`/`overall` 三组 `call_count`/`success_count`/`failure_count`/`success_rate`/`partial`/tokens/`total_duration_seconds`/`cost_usd`），由 `_compute_performance_summary()` 在 `run_deliberation()` 出口一次性计算，通过 `mmd.performance`（`return_trace`）和 `mmd_analysis.performance`（`return_analysis`）暴露；不新增配置项，因为这套核算本身零 I/O 成本，复用既有开关即可。两个结构性限制照实记录、这一轮不修：(1) coordinator 阶段调用没有 try/except 包裹，失败会直接中止整个 `run_deliberation()`，因此已返回结果里 `coordinator.failure_count` 恒为 0、`coordinator.partial` 恒为 `False`，没有“coordinator 部分失败”这个可表示的状态；(2) planning 模式下一个 topic 在完成前失败（如 quorum 不达标）会丢失其内部逐模型失败细节，只在 `failed_topics` 里留下一条字符串，不计入 `performance`。

**兼容性（已完成）**：先用一次独立的、不预设结论的 Explore-agent 审计对照真实代码（而不是文档自述）核验这四项，找到的是真缺口，不是需要补文档的假缺口。已修复：(1) `ConversationTurn.name` 此前只解析不渲染（死代码），assistant 消息的 `tool_calls`（函数调用意图/参数）此前在整个包里都没被读取过——`_extract_text(None, ...)` 直接返回空字符串静默丢弃，未测试，且文档"保留...多轮 assistant"的表述掩盖了这一点。现在两者都被渲染进 `rendered_context_block()`：`name` 追加到 turn 标签（如 `[user, name=alice]`），`tool_calls` 渲染成 `name(arguments)` 形式的人类可读摘要追加到 turn 内容（`arguments` 保留原始 JSON 字符串，不重新解析），格式不合法的条目直接跳过、不抛异常——这只是让 panel/coordinator 模型看到已经在消息列表里的信息，**不是**新增了 function-calling 执行能力——渲染的是调用方历史会话里已有的 `tool_calls`，与下方"工具/联网"一行 MMD 自己执行 `web_fetch` 的新能力是两回事，调用方历史里的 `tool_calls` 本身仍然不会被 MMD 执行。(2) `response_format`（OpenAI JSON-mode/结构化输出参数）此前在整个包里完全没有处理——不在转发白名单、不被读取、不转发、文档也没提——是本轮审计找到的最具体的"静默忽略请求字段"缺口；现在无条件返回 400（`_build_config` 里 `response_format is not None` 检查，复用既有的 `except (TypeError, ValueError, ValidationError)` 转换逻辑），且不像 `tool_mode` 那样提供 passthrough 选项——盲目把调用方的 JSON schema 转发给 MMD 自己结构化输出机制不理解的 panel/coordinator 模型，静默出错比明确拒绝更糟。(3) `parallel_tool_calls` 此前同样完全没有接线；现在仅在 `tool_mode="experimental_passthrough"` 下随 `tools`/`tool_choice`/`max_tool_calls` 一起原样转发，记录进 `mmd.tooling.parallel_tool_calls`；单独携带（没有 tools/tool_choice）是无意义组合，不做特殊校验，直接忽略。streaming 审计结论：架构本身没问题（`astreaming`/`streaming` 与 `acompletion` 共用 `_run_deliberation_and_build_response`，先完整物化结果再切块，不存在"部分 yield 后抛异常"的风险）——缺口只在测试覆盖，本轮已补齐 `return_analysis=True`、`deliberation_policy` 组合、`QuorumNotMetError` 经 streaming 路径的端到端测试。契约稳定性：新增 `python/tests/test_contract.py` 锁定 `mmd`/`mmd_analysis` 顶层 key 集合，未来一次意外的字段改名/删除会让测试失败而不是静默通过；`docs/architecture.md` 新增版本号 bump 策略说明。诚实记录的剩余边界：MMD 不执行调用方历史会话里的 `tool_calls`，渲染只是背景 context；MMD 自己的 `web_fetch` 工具执行循环（`tool_mode="mmd_native_web"`）是另一条独立路径，见下方"工具/联网"一行。

**默认 panel（已完成）**：验收原文把"default panel"和"单一配置对象"写成一个"或"关系（见 `docs/research/fusion-litellm-alignment-2026-07-09/report.md` §6："...或明确提供单一 `mmd` 配置对象而非多个散参数"）——本轮选择实现 default panel，不做配置对象重构。理由：`DeliberationConfig` 本身已经是 MMD 内部唯一的单一配置对象（一个 Pydantic model，所有 orchestrator 函数都只接受它）；把 `optional_params`/YAML 里目前 31 个平铺的散参数（`analysis_models`、`preset`、`mmd_mode`、各种 timeout/tool/trace key）包进一个新的嵌套 wrapper key，在这个代码库和 LiteLLM 自己的 custom-provider 惯例里都没有先例（唯一存在的嵌套只有 `model_params`/`analysis_model_params`/`coordinator_model_params`，且那是打包模型调用参数，不是 MMD 自己的控制面配置），是一次没有明确收益的破坏性重排；default panel 更小、纯增量，且直接服务"省略 panel 也能用"这个真实目标，而不只是满足一句验收文案。机制：`analysis_models` 省略/为空时，`mmd_litellm/client.py::LiteLLMCompletionClient.discover_model_groups()` 读取注入的 Router 的 `get_model_names()`，返回调用方视角的 model group/alias 名字列表。两条安全边界：(1) **绝不**读取 `router.model_list`/`router.get_model_list()`——本次会话对 litellm==1.91.0 做了真实验证，这两个属性返回的是已解析的明文部署配置，包含明文 `litellm_params.api_key`；(2) 只有注入的 client 是 Router-backed（真正跑在 LiteLLM Proxy/Router 之下）才会触发发现，绝不凭空硬编码厂商模型列表。`get_model_names()` 不是正式带版本保证的公共 API，但它是 LiteLLM 自己 Proxy 服务器代码（`GET /v1/models`、`GET /models`、`is_known_model()`、鉴权与 model-access-group 端点）反复依赖的同一个调用，判断为"非正式但高度依赖、值得基于其构建"；集成点收窄成单个方法（`discover_model_groups()`），未来 LiteLLM 行为变化时改动面很小。发现结果按 `mmd_litellm/orchestrator.py::_is_mmd_alias()`（从既有递归 guard 抽取的共享判定）过滤掉 MMD 自身别名，并额外排除当前调用别名 `public_model` 本身（防御性处理：运营方给 MMD 部署起的 model_name 未必匹配 "mmd-fusion"/"mmd/*" 这个命名模式）；过滤后为空时抛出一条区别于"analysis_models 必填"的明确错误。不新增配置项——省略即触发，这才是"省略 panel 也能用"的真实含义，把它挪到另一个显式开关背后只是把摩擦转移了位置。严格增量：`analysis_models` 今天是 `Field(min_length=1)`，所有现存配置都已显式提供它，完全不受影响；测试用的假 client（`ScriptedClient` 等）没有 `discover_model_groups` 方法，行为不变。诚实记录的限制：非 Proxy/无 Router 的裸 SDK 调用（直接 `litellm.acompletion`）仍然没有默认 panel 可用，因为没有任何安全的东西可以内省——这是设计使然，不是遗漏。

**工具/联网（已完成）**：验收原文只写"至少一个端到端 tool/web 路径"，没有规定形状。评估过两条路径：(a) 通用执行器——MMD 执行调用方自带的任意 tool schema；(b) MMD 自己定义并执行的单一受限工具。选了 (b)：调用方自带的任意 function schema 没有一个自然的"web"落点，且让 MMD 盲目执行攻击者可影响的任意函数是不必要的执行面；也评估过把执行完全交给 LiteLLM 自身（provider-native 搜索模型如 `gpt-4o-search-preview`，或 LiteLLM Proxy 的 `websearch_interception` callback）——两者都对 MMD 完全不透明：MMD 拿不到可强制执行的调用上限，也拿不到可写入 `mmd.tooling` 的 result trace，而验收原文明确要求这两者由 MMD 提供，`websearch_interception` 本身也是一个仍在修 bug 的新特性且需要调用方自带付费搜索 API key。因此新增 `tool_mode="mmd_native_web"`：panel 阶段（`coordinator_tools_enabled` 时也含 coordinator）自动获得 MMD 自带的 `web_fetch(url)` 工具 schema，与调用方自带的 `tools`/`tool_choice` 互斥（同时携带两者返回 400）。执行循环：`mmd_litellm/client.py` 的 `CompletionOutput` 新增 `tool_calls` 字段，`_extract_content` 不再在正文缺失时抛异常（只有正文和 `tool_calls` 都缺失才抛）；`mmd_litellm/prompts.py::CompletionRequest` 新增 `extra_turns`/`with_extra_turns()` 支持把 assistant 的 `tool_calls` 消息和 `tool` 角色的结果消息追加进下一轮请求；`mmd_litellm/orchestrator.py::ToolExecutingClient` 是第四个 `CompletionClient` 装饰器，包在已有的 `UsageCollectingClient(CallLimitedClient(...))` 外层（工具循环里的续接模型调用仍计入 `max_total_calls` 并被计费/计时），检测到 `tool_calls` 就执行、回灌结果、再次调用，最多 4 轮（`MAX_TOOL_STEPS_PER_CALL`）后仍未收敛则抛 `ValueError`——发生在 panel fan-out 阶段时会经由既有的 `except Exception` 变成普通 `PhaseFailure`，由 quorum 处理，不会无谓地拖垮整个 run。全局调用上限复用了已有但此前从未被强制执行的 `max_tool_calls` 字段（在 `experimental_passthrough` 下仍是纯透传语义不变；只有 `mmd_native_web` 下才是 MMD 自己强制执行的预算），省略时默认 4；超出时抛 `ToolCallBudgetExceededError` → `MMDProviderToolBudgetError`（429，`mmd_tool_call_budget_exceeded`，与既有的 `mmd_call_budget_exceeded` 是两个独立错误码，不合并）——与 `CallBudgetExceededError` 一样中止整个 run，而不是退化成单模型失败。`web_fetch` 本身（`mmd_litellm/tools.py`，纯标准库、零新依赖）只做 HTTP(S) GET、截断到 20000 字节、不跟随重定向（3xx 会作为工具错误回灌，而不是被追踪）；SSRF 边界按真实安全边界对待而非玩具校验：scheme 白名单仅 http/https，`socket.getaddrinfo` 解析后用 `ipaddress` 拒绝 private/loopback/link-local/multicast/reserved/unspecified 的**任意一个**解析结果，且连接时直接连到已校验过的 IP（而不是连接时重新解析主机名），从而关闭 DNS-rebinding 的 TOCTOU 窗口，同时仍用原始 hostname 做 TLS SNI 与证书校验。仅有的例外通道是进程级环境变量 `MMD_WEB_FETCH_ALLOW_PRIVATE_HOSTS`（逗号分隔的主机名白名单），只在测试里用来让 `web_fetch` 指向真实本地 HTTP server；它从不读取请求体/`optional_params`，远程调用方无法用它绕过 SSRF 防护。工具执行失败（被拦截/超时/连接失败/非 2xx）从不抛异常，统一返回 `status="error"/"blocked"` 并把可读的错误信息回灌成正常的 tool 结果消息，模型可以继续或放弃——与既有的"退化而非崩溃"哲学一致。Result trace 扩展了既有的 `ToolTraceInfo`（新增 `tool_calls_executed`、`tool_calls_failed`、`tool_call_events` 列表，每条含 `call_index`/`phase`/`model_id`/`role`/`topic_id`/`tool_name`/`arguments`/`status`/`result_preview`/`error`/`duration_seconds`，沿用 `UsageEvent`/`UsageSummary` 已有的"逐事件列表 + 聚合计数"结构），全部是嵌套在 `tooling` 内的新增字段，不需要 bump `trace_version`，也不需要改 `test_contract.py` 锁定的顶层 key 集合。真实集成测试：`python/tests/test_proxy_e2e.py` 新增两个真实起 `litellm` Proxy 子进程的场景——一个在测试进程里起一个真实本地 HTTP server，让 `web_fetch` 通过真实 socket 抓取并把内容写入 `mmd.tooling` 的 trace（证明整条链路是真实的，不是 mock）；另一个不设置 `MMD_WEB_FETCH_ALLOW_PRIVATE_HOSTS`，证明 SSRF 拦截确实在服务端生效且整个请求仍优雅完成（200，`status="blocked"`），而不是崩溃。诚实记录的已知限制：一次只支持 MMD 自己定义的这一个工具，不是通用 tool-calling 执行能力；不跟随重定向；单轮最多 4 步是固定常量，暂不可配置；`web_fetch` 只返回原始响应正文文本，不做 HTML 内容抽取。LiteLLM 自己的 provider-native 搜索模型（如 `gpt-4o-search-preview`）和 Proxy 的 `websearch_interception` callback 仍然是运营方可选用的、与 MMD 无关的另一条路径——MMD 不封装它们，因为它们无法提供本条目要求的 MMD 侧调用上限与 result trace。

MMD 的多轮 critique/revise/vote 是审计差异化，不等于用户可感知的 Fusion parity；默认体验必须先做到低摩擦、可控成本和诚实的能力边界。

**P1 全部完成；下一阶段进入 P2。**

### P2 — 真实模型覆盖与质量基准

**运行覆盖**：在默认跳过的 integration suite 中，以环境变量读取 key，覆盖 quick、standard、planning、partial quorum、timeout、model-call budget、stream 与至少一个 tool/web path。产物只记录脱敏的 model id、duration、usage、phase/quorum，不保存 secret 或原始敏感 prompt。

**质量基准**：选择 30–50 个可核验事实题与主观权衡题，固定模型版本、温度和预算，比较单模型、MMD quick、MMD standard 以及可用时的 Fusion。记录正确率、引用可核验率、失败/拒答率、p50/p95、tokens/cost 和人工偏好。多轮投票可能提高透明度，也可能放大同源模型的错误共识；必须由基准而不是叙事判断。

**发布门槛**：至少一位外部用户在独立 LiteLLM Proxy 环境复现安装、配置、运行和故障边界。

### P3 — LiteLLM 社区与 upstream

先提交 design Issue，再提交小范围 PR。不要直接把全部 MMD 协议、schemas 和 prompts 搬进 LiteLLM。

1. **Issue**：请求维护者确认是否欢迎一份 provider-agnostic 的“多模型 orchestration CustomLLM”文档/示例，范围只含 conversation preservation、nested metadata/recursion、streaming、callback-safe audit metadata 和 secret-free testing。
2. **首个 PR**：仅文档 + 小示例 + 测试，零核心行为变更；例子不依赖 MMD 名称或 vote schema。
3. **条件性代码 PR**：只在维护者明确需要时，贡献 generic parent-call metadata/depth helper 或 package-registration adapter；不得依赖 MMD，不改变现有 provider 默认路径。
4. **内置 MMD provider**：只有维护者明确要求时才设计，届时应保持外部 optional dependency，并已完成 P0–P2。

LiteLLM PR 必须遵守其 CLA、Conventional Commit/branch、单问题 scope、至少一个测试、`make lint` 与 `make test-unit` 要求。不得提交真实 key、用户 `.env`、本地 model config 或依赖真实服务的单元测试。

## 暂不进入主线的工作

- 自建 Backend API、Postgres conversation/run 服务和 Web MVP。
- 复制 LiteLLM 的 virtual keys、cost map、Router、global callback dispatch 或 provider fallback。
- 未经维护者确认的 LiteLLM 大型内核 PR。
- 将“更可审计”宣传为未经基准验证的“更准确”。

这些工作只在 P0–P3 完成、存在明确用户需求或 LiteLLM 不提供必要扩展点时重新评估。

## 文档治理

- 权威文档限定为 `README.md`、`docs/architecture.md` 和本文件。
- 每次状态变化更新本文件的阶段表、当前 P 阶段和验收结果。
- 每次行为/配置/契约变化更新 `docs/architecture.md`。
- 带日期的 `docs/research/` 只保存证据和历史快照，不得覆盖本文件中的现行路线。
