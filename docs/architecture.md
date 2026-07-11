# MMD 架构与运行参考

本文件是 MMD 的权威技术参考：它描述已实现的协议、运行边界、LiteLLM 集成和验证方法。后续开发优先级与验收标准只在 [统一开发路径](development.md) 维护。

## 定位与边界

MMD 是一个多模型协商 strategy engine。它让多个模型独立提出观点、互评、修订、归并并投票，再输出有强度标识的结论。LiteLLM 仍负责 provider API 适配、model group/alias、路由、fallback、认证、预算、HTTP Proxy 与通用 callbacks。

```text
OpenAI-compatible client
  → LiteLLM SDK / Proxy
  → mmd/fusion custom provider
  → MMD strategy engine
  → LiteLLM Router / acompletion
  → panel 与 coordinator models
  → ModelResponse + optional MMD trace
```

MMD 不是 OpenRouter Fusion 的等价实现。当前没有自动 panel、外层模型按需调用、端到端工具循环，也没有暴露协商阶段进展的 streaming（`stream=True` 只流式返回已完成的最终答案）；这些差距与处理原则见 [统一开发路径](development.md#fusion-级验收缺口)。

## 协商协议

### 模式

| 模式 | 流程 | 适用场景 |
| --- | --- | --- |
| `quick` | Propose → Normalize → Compose | 低摩擦、多模型综合；Python provider 默认模式。 |
| `standard` | Propose → Critique → Revise → Normalize → Vote → Compose | 高价值判断、技术争议和显式分歧。 |
| `planning` | Outline → 每主题并行 `standard` → Section Compose | 架构规划、技术选型和长输出。 |

`planning` 的 Outline 最多生成 8 个 topic。每个 topic 独立运行完整协议，topic 失败不会中断其余 topic；最终 summary 由各 section 的 `tldr` 确定性拼接，避免额外引入跨 topic judge。

### 不可变约束

1. **可追溯性**：每个 normalized candidate 必须有非空 `source_claim_ids`，不能只保留 coordinator 的结论。
2. **比例制共识**：分类适用于任意 panel 大小，不硬编码“三个模型”。默认规则为：全体 approve 为 `strong_consensus`；达到 0.66 且无关键反对为 `qualified_consensus`；关键/重大反对或不足门槛为 `disputed`；低于拒绝阈值为 `rejected`。
3. **run 隔离**：claim/candidate id 以 `${run_id}:${local_id}` 作用域化，避免跨 run 冲突。
4. **quorum 优先可用性**：默认达到 2/3（向上取整）即可继续，但必须在 trace 标记 `partial`；达不到 quorum 则返回阶段、所需人数与失败模型。
5. **结构化输出修复**：每个阶段按 schema 校验；格式不合法时可请求模型修复，超过修复次数才失败。
6. **预算可见**：每模型 timeout、总 run timeout 与总模型调用数必须可配置并在失败时返回明确错误。

当前规则的一个已知边界：存在任意 `critical` 反对时优先归入 `disputed`，因此“全票 critical 反对”不会自动变成 `rejected`。这是已知产品规则，不是运行时 bug。

## TypeScript CLI

### 本地运行

```bash
npm install
cd apps/cli
npm run start -- --question "Should a small team adopt a monorepo?" --mode standard
```

| 参数 | 说明 |
| --- | --- |
| `--question`, `-q` | 待协商问题。 |
| `--mode` | `standard`、`quick` 或 `planning`。 |
| `--models`, `-m` | mock provider 使用的模型 id，逗号分隔。 |
| `--fail-models` | mock provider 的故障注入，用于 quorum 测试。 |
| `--config`, `-c` | 模型配置路径，默认 `./models.config.json`。 |
| `--provider mock` | 强制使用 mock，不读取真实配置。 |
| `--out`, `-o` | 输出目录，默认 `./out`。 |

真实模型配置从 `apps/cli/models.config.example.json` 和 `.env.example` 复制。本地 key/config 不得提交。

## LiteLLM Provider

### 安装与 handler

从源码安装：

```bash
pip install './python[litellm]'
```

`mmd-litellm` 暴露 `mmd/fusion` custom provider。LiteLLM Proxy 当前将 `custom_handler` 相对 YAML 目录加载，因此将 `python/examples/mmd_handler.py` 复制到 Proxy YAML 所在目录；该 shim 仅导入包中稳定的 `mmd_litellm.custom_handler.mmd_custom_llm`，不复制实现。

### 最小 Proxy 配置

```yaml
model_list:
  - model_name: mmd-fusion
    litellm_params:
      model: mmd/fusion
      analysis_models:
        - openrouter/openai/gpt-4o-mini
        - openrouter/google/gemini-flash-1.5
      coordinator_model: openrouter/openai/gpt-4o-mini
      mmd_mode: quick
      return_trace: false

litellm_settings:
  custom_provider_map:
    - provider: mmd
      custom_handler: mmd_handler.mmd_custom_llm
```

生产配置请从 `python/examples/litellm_config.yaml` 开始，并使用真实可用的 LiteLLM model ids。

### 主要配置项

| 参数 | 当前含义 |
| --- | --- |
| `analysis_models` | 必填的 panel model ids 或 LiteLLM model groups。 |
| `coordinator_model` | 可选；未给出时使用第一个 panel model。 |
| `mmd_mode` | `quick`（默认）、`standard` 或 `planning`。 |
| `quorum_ratio` | 需要成功响应的最小比例，默认 `0.66`。 |
| `preset` | `cheap` / `balanced` / `strong`；仅限制已配置 panel 的大小并设置 timeout，**不会**自动选择模型。 |
| `max_analysis_models` | panel 上限，1–8。 |
| `per_model_timeout` / `max_run_timeout` | 单调用 / 整个 deliberation 的秒级限制。 |
| `max_total_calls` | 所有 model 调用（含 repair 和 planning topic）的硬上限。 |
| `max_completion_tokens` / `reasoning` / `temperature` | 透传给底层 LiteLLM 调用的生成控制。 |
| `return_trace` | 返回完整 `mmd` 审计 trace，默认关闭。 |
| `return_analysis` | 返回轻量 `mmd_analysis`，默认关闭。 |
| `mmd_log_trace` | 将限量审计 payload 附到 LiteLLM request logging context，默认关闭。 |
| `tool_mode` | `reject`（默认）或 `experimental_passthrough`。请求携带 `tools` 或非空 `tool_choice` 且未设为 `experimental_passthrough` 时，返回 400；见下方错误契约。 |

`mmd_log_trace` 的 payload 受 `max_log_trace_candidates` 控制（默认 50）；完整 `return_trace` 不会被此限制截断。

### 返回与错误契约

默认响应保持普通 chat-completion 形状：

```json
{
  "choices": [{"message": {"role": "assistant", "content": "..."}}],
  "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
}
```

若底层模型返回 usage，MMD 会聚合 panel/coordinator usage。`return_trace=true` 会额外返回顶层 `mmd`，其中固定包含 `trace_version: 1` 和 `protocol: "mmd.v1"`；它包含 quorum、失败、usage 与可追溯的协商数据，以及 `tooling`（`enabled_for_panel`、`enabled_for_coordinator`、`tool_count`、`tool_choice`、`max_tool_calls`、`tool_mode`、`experimental`）。`return_analysis=true` 返回较小的 `mmd_analysis`，包括共识摘要、分歧、coverage、独有观点和限制。

响应由 LiteLLM 调用方传入的 `model_response`（`ModelResponse`）对象原地填充，不再通过构造一次无关的 `mock_response` completion 来间接生成；未提供 `model_response` 且 LiteLLM 已安装时，MMD 会自行构造一个 `ModelResponse`，否则回退为普通 dict。

`stream=True` 时，MMD 先完整跑完 deliberation（与非流式路径完全一致，包括 quorum/预算/超时行为），再把最终答案按约 40 字符的词边界切块，通过一串 `GenericStreamingChunk` 返回：除最后一块外 `is_finished=False`、`finish_reason=""`、`usage=None`；最后一块携带 `is_finished=True`、真实 `finish_reason`、聚合后的 `usage`，并在存在 `return_trace`/`return_analysis` 时通过 `provider_specific_fields` 携带 `mmd`/`mmd_analysis`（对应 SSE 中该帧的顶层 `mmd`/`mmd_analysis` 字段）。**调用方必须在请求体中设置 `stream_options: {"include_usage": true}` 才能在流中收到 `usage`**——这是标准 OpenAI/LiteLLM 语义（LiteLLM 默认丢弃流式 usage），不是 MMD 特有行为。首字节前 deliberation 已全部完成；不暴露独立的阶段/进度事件。

错误映射如下：请求/配置错误为 `MMDProviderBadRequestError`（400），总调用预算为 `MMDProviderBudgetError`（429），总超时为 `MMDProviderTimeoutError`（504），quorum 或运行错误带有阶段/失败细节。请求携带 `tools` 或非空 `tool_choice`、且 `tool_mode` 未设为 `experimental_passthrough` 时，同样返回 `MMDProviderBadRequestError`（400）。会话中出现不支持的 content part（例如 `image_url`）时也返回 400，而不是静默丢弃。安装 LiteLLM 后，bad-request 和 API 变体继承 LiteLLM 原生错误类型。

### 当前限制

- `completion`/`acompletion`/`streaming`/`astreaming` 均已实现；流式路径不暴露独立的阶段/进度事件（那需要一套独立协议，而不是伪装成 token），只流式返回最终答案。
- deliberation 问题由完整会话适配器（`mmd_litellm/conversation.py`）构建：保留 system/developer 消息、多轮历史与 tool 结果消息作为背景 context；仅支持纯文本 content（字符串或 `type: "text"` parts），其余 content part 类型（如 `image_url`）会 fail-fast 返回 400，而不是静默丢弃。
- `tools`/`tool_choice` 默认被显式拒绝（400）；调用方须设置 `tool_mode: "experimental_passthrough"` 才会透传给内层模型（仍不执行 function-calling loop，也不会把 tool results 回灌下一轮，且响应会在 `mmd.tooling.experimental` 中标注）。
- `mmd_deliberation_depth` 防止 MMD 内层再次递归调用 MMD；这不是 OpenRouter 的 header 协议。

调用方不得将上述限制误解为已具备通用 tool-calling 兼容性，或流式路径会暴露协商过程中的阶段性进展（它只流式返回已经完成的最终答案）。

## 验证

```bash
# TypeScript
npm run test
npm run build

# Python unit tests 与包构建
uv run --project python --extra test pytest
uv build --project python

# Proxy e2e（真实起 litellm Proxy 子进程；normal/stream/callback/Router alias/native error/recursion/budget/timeout）
uv run --project python --extra dev pytest python/tests/test_proxy_e2e.py

# Proxy HTTP smoke（scripted panel，无 key；手动脚本，与上面的 pytest 并存，不互相替代）
uv run --project python --extra proxy python python/scripts/proxy_smoke.py
```

真实 Proxy smoke 使用环境变量中的 provider key：

```bash
export MMD_SMOKE_ANALYSIS_MODELS="openrouter/openai/gpt-4o-mini,openrouter/google/gemini-flash-1.5"
export MMD_SMOKE_COORDINATOR_MODEL="openrouter/openai/gpt-4o-mini"
uv run --project python --extra proxy python python/scripts/proxy_real_smoke.py
```

可选项包括 `MMD_SMOKE_MODE`、`MMD_SMOKE_PRESET`、`MMD_SMOKE_MAX_RUN_TIMEOUT`、`MMD_SMOKE_MAX_TOTAL_CALLS`、`MMD_SMOKE_MAX_TOPICS`、`MMD_SMOKE_EXPECT_PARTIAL` 和生成参数。真实 smoke 不得输出 API key，也不能替代 streaming/tool 路径的测试。
