# MMD LiteLLM Fusion Replacement 主线技术文档

日期：2026-07-05  
状态：M2' 主线开发依据  
相关文档：[docs/litellm-integration.md](litellm-integration.md)、[docs/protocol.md](protocol.md)、[docs/prior-art.md](prior-art.md)、[multi-model-deliberation-dev-roadmap.md](../multi-model-deliberation-dev-roadmap.md)

## 1. 核心判断

本 branch 的目标不是把 MMD 缩窄成一个只服务少数高价值问题的审计层，而是把 MMD 做成 **LiteLLM 生态里的 open-source Fusion replacement**。

更准确的定位是：

> MMD is an open-source Fusion-like router for LiteLLM, with stronger multi-model integration through auditable consensus instead of a single judge.

换成中文：

> MMD 是面向 LiteLLM 的开源 Fusion-like router/provider，用可审计共识机制替代单一 judge 对多模型回答的主观综合。

OpenRouter Fusion 已经验证了一个重要产品判断：**多模型 panel + 普通 chat completion 入口** 是有价值的。用户不需要理解内部流程，只需要调用一个模型/插件，系统内部并行调用多个模型并综合结果，外部仍返回普通回答。MMD 应该继承这个入口形态，而不是要求用户先理解 Propose / Critique / Revise / Normalize / Vote / Compose 六阶段协议。

MMD 相对 Fusion 的核心差异不是“也有多个模型”，而是 **多模型整合机制更强**：

- Fusion 的中心机制是 panel + judge。多个模型给 judge 参考，judge 做结构化分析，最终由外层模型合成。
- MMD 的中心机制是 propose / critique / revise / normalize / vote / compose。多个模型不只是并行回答，还能互评、修订、显式投票，并通过确定性函数分类共识。
- Fusion 的泛用性更强；MMD 当前的协议可信度、可追溯性和分歧处理更强。

因此后续开发的主线不是“做一个小众审计工具”，而是：

1. 先达到 Fusion-like 的默认可用性和配置便利。
2. 再用 MMD 的协议证明它是更可信、更可审计、更适合自托管和生产治理的 Fusion replacement。

## 2. 为什么 LiteLLM 社区需要这个

LiteLLM 是开源 LLM gateway，已经覆盖 provider 适配、OpenAI-compatible API、Proxy、Router、fallback、virtual keys、预算、成本追踪、日志和 callbacks。它擅长回答“如何统一调用、管理和治理模型”，但目前主能力层仍是：

- 路由到哪个模型。
- 对单次模型调用做 fallback / retry / budget / logging。
- 对单个输出做 guardrail 或 judge-style 检查。

MMD 要补的是另一个能力层：

> 多个模型同时参与一次回答，并把它们的回答整合成一个可审计的最终结论。

这个能力在 LiteLLM 生态里有自然价值：

- LiteLLM 用户已经有多个 provider / model group / fallback 配置，MMD 可以直接复用这些资源。
- LiteLLM 用户关心自托管、成本、日志、key 管理和生产治理，MMD 的 trace / quorum / classification 能直接服务这些需求。
- OpenRouter Fusion 证明了“multi-model answer synthesis”有市场心智；LiteLLM 生态缺一个开源、自托管、可审计版本。

项目价值不应被表达为“比单模型更聪明”。更准确的价值主张是：

- 在高不确定性问题上降低单模型偶然失误影响。
- 暴露不同模型之间的真实分歧。
- 将 consensus / disputed / rejected 分类从单一 judge 的主观判断改成显式投票后的确定性规则。
- 让最终答案可以追溯到原始 claims、reviews、votes 和 partial quorum 状态。

## 3. 产品形态：先像 Fusion 一样好用

默认体验必须接近 Fusion，而不是暴露 MMD 内部复杂度。

### 3.1 用户入口

用户侧应保持普通 LiteLLM / OpenAI-compatible 调用：

```json
{
  "model": "mmd-fusion",
  "messages": [
    { "role": "user", "content": "Compare FastAPI and NestJS for a small internal API." }
  ]
}
```

配置侧应保持 LiteLLM 心智：

```yaml
model_list:
  - model_name: mmd-fusion
    litellm_params:
      model: mmd/fusion
      analysis_models:
        - openrouter/z-ai/glm-5.2
        - openrouter/deepseek/deepseek-v4-pro
        - openrouter/moonshotai/kimi-k2.6
      coordinator_model: openrouter/deepseek/deepseek-v4-pro
      mmd_mode: quick
      return_trace: false
```

默认返回必须像普通 chat completion：

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "..."
      }
    }
  ]
}
```

MMD 内部 trace 默认不进入正文。只有用户显式设置 `return_trace=true` 或配置 callback/logging 时，才暴露完整 trace。

### 3.2 默认模式

默认模式应该是 `quick`，不是完整 `standard`。

原因：

- Fusion 的泛用性来自低摩擦和相对可控成本。
- `standard` 的 critique / revise / vote 成本更高，不适合作为所有请求默认路径。
- `quick` 已经能提供 panel 多样性、normalize、source coverage 和普通最终答案，适合作为 Fusion-like 默认体验。

推荐模式定位：

| mode | 默认性 | 使用场景 | 成本/延迟 |
|---|---|---|---|
| `quick` | 默认 | 普通 multi-model answer synthesis | 接近 Fusion 心智 |
| `standard` | 显式高级模式 | 高价值判断、技术争议、需要显式分歧 | 高 |
| `planning` | 显式高级模式 | 架构规划、技术选型、长文档 | 高，但 topic 并行 |

### 3.3 默认命名

对外命名优先使用 Fusion / LiteLLM 用户熟悉的词：

- `analysis_models`：保留，贴近 Fusion。
- `coordinator_model`：可保留，用于 normalize / compose。
- `mmd_mode`：短期保留；长期可考虑 `strategy` 或 `fusion_mode`。
- `return_trace`：完整审计 trace。
- `return_analysis`：轻量 Fusion-like analysis，后续新增。

内部术语如 claim、ballot、classification、quorum 可以出现在 trace 和高级文档中，但不应成为默认使用门槛。

## 4. 差异化：MMD 为什么是更强 replacement

MMD 的协议优势要服务 replacement 目标，而不是把产品变复杂。

### 4.1 单一 judge vs 显式共识

Fusion-style judge synthesis 的问题不是“不好”，而是最终综合权集中在一个模型身上。MMD 要强调：

- 每个模型先独立提出 claims。
- 模型之间可互评和修订。
- 候选 claims 保留 `source_claim_ids`。
- vote 阶段由每个模型显式表达 approve / condition / object / abstain。
- 最终 classification 由确定性函数计算，而不是 coordinator 自行判断。

这让 MMD 更适合开源、自托管、生产治理语境，因为用户可以检查“结论为什么这样分类”。

### 4.2 可追溯性是协议约束

`source_claim_ids` 不是 UI 附加信息，而是 schema 层硬约束。任何 candidate claim 都必须能追溯回原始 claims。后续所有 provider response、callback payload、trace viewer 或日志集成，都必须保留这条链路。

### 4.3 partial quorum 是生产能力

单个模型失败不应拖垮整个 run。MMD 的 quorum 机制应成为生产可用性的卖点：

- 达到 quorum：继续生成答案，并在 trace 标记 partial。
- 未达到 quorum：返回清晰错误，包含 phase、required、respondent_count、failed models。
- planning 模式下：单个 topic 失败不拖垮整份 plan，除非所有 topic 都失败。

### 4.4 planning 是 replacement 的高级差异化

Fusion 的默认形态擅长泛用问答；MMD 的 planning mode 应成为“为什么它不只是 Fusion clone”的高级能力。

planning mode 的产品定位：

- 面向架构规划、技术选型、产品方案、风险评估。
- 先 outline，再 per-topic deliberation。
- topic 并行，避免 wall-clock latency 线性放大。
- executive summary 由 section `tldr` 确定性拼接，避免再次引入跨 topic judge。

## 5. 架构主线

目标架构：

```text
OpenAI-compatible client
        |
        v
LiteLLM Proxy / SDK
        |
        v
mmd/fusion virtual provider
        |
        v
MMD strategy engine
        |
        +--> LiteLLM Router / acompletion -> analysis model A
        +--> LiteLLM Router / acompletion -> analysis model B
        +--> LiteLLM Router / acompletion -> analysis model C
        +--> LiteLLM Router / acompletion -> coordinator
        |
        v
MMD protocol core
        |
        v
OpenAI-compatible response
        +
        +--> optional top-level mmd trace
        +--> optional callback/logging trace
```

### 5.1 LiteLLM 负责

- Provider API 适配。
- Router / model groups / aliases。
- Fallback / load balancing。
- API keys / virtual keys。
- Spend tracking / budget。
- Request logging / callbacks。
- OpenAI-compatible response transport。

### 5.2 MMD 负责

- 将用户请求映射为 MMD strategy run。
- fan-out 到 analysis models。
- 结构化 prompt / repair / schema validation。
- claim / candidate / vote / classification 数据结构。
- quorum 降级和 partial trace。
- 默认最终答案正文。
- optional analysis / trace payload。

### 5.3 当前实现状态

当前 Python PoC 已完成：

- `mmd/fusion` custom provider shell。
- `quick` / `standard` / `planning`。
- mock Proxy HTTP smoke。
- 真实 OpenRouter panel quick smoke。
- `return_trace=true` 顶层 `mmd.trace_version === 1`。
- 递归保护。
- provider 前缀 preflight。
- Router-aware completion client（显式 `router` 注入优先，未注入时 fallback 到 `litellm.acompletion`）。
- response `usage` 聚合第一版（含 trace 中的阶段/模型级 usage events 和 usage unavailable 标记）。

当前缺口：

- callback/logging trace 尚未落地。
- `return_analysis` 尚未实现。
- preset / auto panel 尚未实现。
- tool / web search 尚未实现。

## 6. 接下来开发主线

### M2'.3a Router-first internal calls

目标：内部 panel / coordinator 调用优先走 LiteLLM Router，而不是只调用裸 `litellm.acompletion`。

验收：

- `analysis_models` 可以是 LiteLLM model group / alias。
- coordinator 也可以是 model group / alias。
- 内部调用保留 `mmd_deliberation_depth` 递归保护。
- 真实 OpenRouter smoke 继续通过。
- mock tests 覆盖 Router client injection。

设计要求：

- 不把 Router 初始化硬编码在 protocol core 里。
- 保持 `CompletionClient` protocol，让 orchestrator 不依赖 LiteLLM 具体实现。
- provider 层负责根据 LiteLLM 上下文构造 Router-aware client。

### M2'.3b Usage aggregation

目标：MMD 对外 response 不再长期返回 `usage: 0`。

验收：

- 聚合 panel / coordinator 调用的 prompt_tokens、completion_tokens、total_tokens。
- `return_trace=true` 时可查看每阶段 / 每模型 usage。
- usage 聚合失败时不影响正文返回，但 trace 标记 usage unavailable。

### M2'.3c Callback / logging trace

目标：完整 trace 不只靠 HTTP response 返回，还能进入 LiteLLM logging / callback 生态。

验收：

- 默认 `return_trace=false` 时正文保持干净。
- 配置 trace logging 时，callback payload 包含 run_id、mode、quorum、classifications、candidate_claims、failures。
- 不把超大 trace 默认写入所有请求日志；必须有开关或 size control。

### M2'.3d `return_analysis`

目标：提供比 full trace 更轻的 Fusion-like structured analysis。

`return_analysis=true` 返回内容应包含：

- consensus_summary。
- disagreements。
- model_coverage。
- notable_unique_points。
- limitations。

它和 `return_trace=true` 的区别：

- `return_analysis` 给应用层直接消费，轻量、稳定、非审计全量。
- `return_trace` 给调试、审计、trace viewer，完整但大。

### M2'.4 Fusion parity config

目标：降低用户配置门槛。

验收：

- `preset=cheap | balanced | strong`。
- `max_analysis_models`。
- `max_completion_tokens` 透传。
- `temperature` 透传给 panel，coordinator 默认低温。
- `reasoning` / provider-specific params 可透传。
- mode-specific timeout defaults。

### M2'.5 Tool / web search compatibility

目标：补齐 Fusion 泛用性的最大缺口。

第一阶段不要求自建 search，只要求兼容 LiteLLM / provider tools：

- tools 参数能安全透传给 panel models。
- 可配置 coordinator 是否可用 tools。
- max_tool_calls 或等价限制。
- trace 中标记 tool availability，而不是把 tool result 混入不可追溯正文。

### M2'.6 Upstream readiness

目标：决定 upstream PR 还是 external package。

验收：

- API 命名贴近 LiteLLM。
- 错误类型映射清晰。
- 无 TypeScript runtime 依赖。
- 文档有最小配置、真实 smoke、成本说明、trace 说明。
- 有示例：quick、standard、planning、return_analysis、return_trace。

## 7. 默认配置建议

第一版面向社区传播的推荐默认：

```yaml
model_list:
  - model_name: mmd-fusion
    litellm_params:
      model: mmd/fusion
      preset: balanced
      mmd_mode: quick
      return_trace: false
      return_analysis: false
      quorum_ratio: 0.66
      per_model_timeout: 60
      max_repair_attempts: 1
```

如果没有 preset，则显式配置：

```yaml
analysis_models:
  - openrouter/z-ai/glm-5.2
  - openrouter/deepseek/deepseek-v4-pro
  - openrouter/moonshotai/kimi-k2.6
coordinator_model: openrouter/deepseek/deepseek-v4-pro
```

默认不建议：

- 默认跑 `standard`。
- 默认返回完整 trace。
- 默认允许无限 tools。
- 默认接受超过 8 个 analysis models。

## 8. 社区叙事

对 LiteLLM 社区的传播语言应聚焦 replacement，而不是内部协议复杂度。

推荐标题：

- Open-source Fusion-like router for LiteLLM.
- Multi-model answer synthesis with auditable consensus.
- A self-hosted Fusion replacement powered by LiteLLM Router.

推荐一句话：

> Call one virtual model, run a panel of models behind it, and get a normal chat completion plus optional auditable consensus trace.

不要主打：

- “六阶段协议很复杂。”
- “多个模型一定比一个模型聪明。”
- “这是一个独立产品后端。”

应该主打：

- OpenAI-compatible 默认体验。
- LiteLLM-native provider / Router / callbacks。
- Fusion-like panel synthesis。
- Explicit consensus, traceability, quorum.
- Self-hosted and auditable.

## 9. 风险与应对

### 风险 1：成本和延迟过高

应对：

- 默认 quick。
- preset 控制模型数量。
- mode-specific timeout。
- max_analysis_models。
- usage aggregation 必须尽快做。

### 风险 2：泛用性不如 Fusion

应对：

- 优先做 `return_analysis` 和 tools compatibility。
- 避免把 standard/planning 作为默认门槛。
- 第一屏文档用 quick smoke 展示，而不是长流程。

### 风险 3：协议优势用户感知不到

应对：

- 做 side-by-side demo：Fusion-style judge vs MMD consensus trace。
- 在 `return_analysis` 中暴露 disagreement / coverage / limitations。
- 在 docs 里展示一个 disputed candidate 的真实 trace。

### 风险 4：LiteLLM upstream 不愿接收重策略

应对：

- 先以 external custom provider package 打磨。
- 保持 upstream-friendly 代码组织。
- 不引入数据库、Web UI、Node runtime。
- 把 heavy features 设为 opt-in。

### 风险 5：模型共同失败

多模型不是万能。若 panel 模型训练分布高度相似，可能共同收敛到错误结论。

应对：

- preset 尽量跨 provider。
- trace 中展示 coverage 和 dissent。
- 不宣传“保证更正确”，宣传“更可审计、可暴露分歧、可降级”。

## 10. 下一步立即执行

按当前状态，下一步不是继续讨论定位，而是进入工程主线：

1. callback/logging trace 落点。
2. `return_analysis` 轻量结构化分析。
3. Advanced config：preset、预算/熔断、max token 限制。
4. 跑通 mock Proxy smoke 和真实 OpenRouter quick smoke。
5. Upstream readiness：异常类型、配置字段、目录和测试形态清理。

Router-first 和 usage 聚合已把 MMD 从“能通过 LiteLLM custom provider 调用”推进到“LiteLLM-native Fusion replacement”的轨道上；接下来重点是生产审计、默认体验和 upstream 形态。

## 11. 参考链接

- OpenRouter Fusion Router: https://openrouter.ai/docs/guides/routing/routers/fusion
- LiteLLM Router: https://docs.litellm.ai/docs/routing
- LiteLLM virtual keys / spend tracking: https://docs.litellm.ai/docs/proxy/virtual_keys
- LiteLLM logging / callbacks: https://docs.litellm.ai/docs/proxy/logging
