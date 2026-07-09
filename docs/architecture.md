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

MMD 不是 OpenRouter Fusion 的等价实现。当前没有自动 panel、外层模型按需调用、端到端工具循环、完整 chat-context 保真或 streaming；这些差距与处理原则见 [统一开发路径](development.md#fusion-级验收缺口)。

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

`mmd_log_trace` 的 payload 受 `max_log_trace_candidates` 控制（默认 50）；完整 `return_trace` 不会被此限制截断。

### 返回与错误契约

默认响应保持普通 chat-completion 形状：

```json
{
  "choices": [{"message": {"role": "assistant", "content": "..."}}],
  "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
}
```

若底层模型返回 usage，MMD 会聚合 panel/coordinator usage。`return_trace=true` 会额外返回顶层 `mmd`，其中固定包含 `trace_version: 1` 和 `protocol: "mmd.v1"`；它包含 quorum、失败、usage 与可追溯的协商数据。`return_analysis=true` 返回较小的 `mmd_analysis`，包括共识摘要、分歧、coverage、独有观点和限制。

错误映射如下：请求/配置错误为 `MMDProviderBadRequestError`（400），总调用预算为 `MMDProviderBudgetError`（429），总超时为 `MMDProviderTimeoutError`（504），quorum 或运行错误带有阶段/失败细节。安装 LiteLLM 后，bad-request 和 API 变体继承 LiteLLM 原生错误类型。

### 当前限制

- 仅非流式 completion 已端到端支持；`stream=True` 尚未实现。
- 当前只从最后一条 user 文本形成 deliberation 问题，不保留完整 system/developer/history/tool/multimodal context。
- `tools`、`tool_choice` 与 `max_tool_calls` 会透传给内层模型，但 MMD 不执行 function-calling loop，也不会把 tool results 回灌下一轮。
- `mmd_deliberation_depth` 防止 MMD 内层再次递归调用 MMD；这不是 OpenRouter 的 header 协议。

调用方不得将上述限制误解为已具备通用 streaming 或 tool-calling 兼容性。

## 验证

```bash
# TypeScript
npm run test
npm run build

# Python unit tests 与包构建
uv run --project python --extra test pytest
uv build --project python

# Proxy HTTP smoke（scripted panel，无 key）
uv run --project python --extra proxy python python/scripts/proxy_smoke.py
```

真实 Proxy smoke 使用环境变量中的 provider key：

```bash
export MMD_SMOKE_ANALYSIS_MODELS="openrouter/openai/gpt-4o-mini,openrouter/google/gemini-flash-1.5"
export MMD_SMOKE_COORDINATOR_MODEL="openrouter/openai/gpt-4o-mini"
uv run --project python --extra proxy python python/scripts/proxy_real_smoke.py
```

可选项包括 `MMD_SMOKE_MODE`、`MMD_SMOKE_PRESET`、`MMD_SMOKE_MAX_RUN_TIMEOUT`、`MMD_SMOKE_MAX_TOTAL_CALLS`、`MMD_SMOKE_MAX_TOPICS`、`MMD_SMOKE_EXPECT_PARTIAL` 和生成参数。真实 smoke 不得输出 API key，也不能替代 streaming/tool 路径的测试。
