# LiteLLM 集成转向设计

本文档描述 `litellm-integration` branch 的技术转向：MMD 不再按原路线优先建设独立 Backend API / Web MVP，而是把已经验证过的多模型协商协议改造成 LiteLLM 生态中的开源 Fusion-like 能力。

这个 branch 的优先级是 **LiteLLM-first / upstream-first**。当 MMD 现有实现、命名、配置形态、返回结构或开发路线与 LiteLLM 的项目习惯冲突时，优先选择 LiteLLM 更容易接受、维护和推广的方案。MMD 的目标不再是保留一个独立产品形态，而是尽可能降低进入 LiteLLM 生态和开源社区的摩擦。

## 1. 决策摘要

原路线：

- `apps/cli` 已经验证 Propose -> Critique -> Revise -> Normalize -> Vote -> Compose 全流程。
- 下一步原定为 M2 Backend API：Conversation / Run API、SSE 事件流、Postgres 持久化。
- 之后再做 M3 Web MVP 和 M4 产品化基础。

新路线：

- 暂停自建 Backend API / Web MVP 作为主线。
- 将 MMD 的协议核心沉淀为 LiteLLM 可调用的多模型协商策略。
- 以 LiteLLM 的 Python SDK / Proxy / Router / custom provider 能力作为运行时和分发层。
- 目标形态是一个开源的 Fusion-like router/provider：用户通过 LiteLLM 的 OpenAI-compatible 接口调用一个虚拟模型，由内部 panel 模型并行回答、互评、修订、投票，并返回带共识分类和溯源信息的最终结果。
- 以 LiteLLM 的集成便利、PR 可接受性、文档可解释性和社区传播为最高工程约束；必要时可以牺牲 MMD 原本的 repo 结构、API 命名和产品路线。

一句话定位：

> MMD should become a LiteLLM-native open-source deliberation strategy, not a separate product that merely happens to call LiteLLM.

## 2. 为什么现在转向

这个 branch 停在 M2 之前是合适的时点。M0/M1/M1.5/v0.2 已经验证了协议价值，但还没有投入数据库、服务端 API、前端状态管理等高沉没成本模块。此时调整方向，能保留协议资产，避免重复建设 LiteLLM 已经很成熟的 gateway 层。

### 2.1 LiteLLM 已覆盖的能力

LiteLLM 的核心价值在于统一 LLM 调用和代理层：

- OpenAI-compatible request / response 格式。
- Python SDK 和 Proxy Server。
- 模型路由、load balancing、fallback、timeout、retry。
- virtual key、预算、成本追踪、日志和回调。
- custom provider / custom handler，可把非标准逻辑接入 LiteLLM。

这些能力与原 M2/M3/M4 规划中的很多基础设施重叠。如果 MMD 继续自建 Backend API 和产品化壳，会把精力放在 LiteLLM 已经解决的问题上，而不是放在 MMD 真正有差异化的协议层。

### 2.2 Fusion 的产品形态提示了更好的入口

OpenRouter Fusion 的重要启发不是“多个模型参与”本身，而是入口形态：

- 用户调用一个虚拟模型或 plugin。
- 内部 panel 模型并行回答。
- 中间层产出结构化分析。
- 外层返回一个普通 chat completion。

这说明多模型协商最适合作为 gateway/router 层能力，而不是要求用户进入另一个独立产品。LiteLLM 正好是开源 LLM gateway，因此是比自建 web/backend 更自然的落点。

### 2.3 MMD 的差异化仍然保留

转向 LiteLLM 不等于把 MMD 降级成普通 ensemble。相反，MMD 应该把差异化更清楚地暴露出来：

- Fusion 主要依赖 judge model 做结构化分析；MMD 使用显式 vote + 确定性 `classifyCandidate`。
- Fusion 文档层面没有 claim 级强制溯源；MMD 的 `source_claim_ids` 是 schema 约束。
- Fusion 是单轮 panel + judge；MMD 支持 critique / revise / vote 多阶段互评。
- LiteLLM 现有 routing 是“选哪个模型回答”；MMD 提供“多个模型共同回答并形成可审计共识”的能力层。

### 2.4 LiteLLM-first 的工程原则

这个 branch 的技术选择按以下顺序排序：

1. **LiteLLM 用户调用最方便**：普通 OpenAI-compatible client 不需要理解 MMD 内部概念，就能调用 `model: mmd-fusion` 或等价模型别名。
2. **LiteLLM 维护者最容易 review**：实现应贴近 LiteLLM 现有 provider/router/custom handler 风格，避免引入跨语言 runtime、复杂外部服务或独立数据库。
3. **LiteLLM 运维能力不被绕过**：所有真实模型调用尽量通过 `litellm.acompletion` / Router，复用 key、fallback、cost tracking、logging、callbacks。
4. **MMD 特性按可选增强暴露**：trace、planning、完整 vote 细节默认关闭或作为高级配置，不让默认响应变复杂。
5. **先合入小核心，再扩展完整协议**：如果完整 standard/planning 太重，优先提供 LiteLLM 容易接受的 quick/standard minimum viable provider，再逐步增加 planning、tool/web search 和 trace viewer。
6. **不维护两套正式产品面**：TypeScript CLI 是参考实现和验证工具，不再是与 LiteLLM provider 并列的一等产品方向。

## 3. 新目标架构

转向后的系统分层如下：

```text
OpenAI-compatible client
        |
        v
LiteLLM Proxy / SDK
        |
        v
MMD LiteLLM provider / router strategy
        |
        +--> LiteLLM Router / acompletion -> panel model A
        +--> LiteLLM Router / acompletion -> panel model B
        +--> LiteLLM Router / acompletion -> panel model C
        |
        v
MMD protocol core
  - structured output validation
  - quorum
  - propose / critique / revise / normalize / vote / compose
  - deterministic consensus classification
  - traceability bundle
        |
        v
OpenAI-compatible ModelResponse
```

### 3.1 LiteLLM 负责的边界

LiteLLM 应该负责：

- provider API 适配。
- API key 和 secret 管理。
- proxy 入口、auth、virtual keys。
- model aliases / model groups。
- load balancing、fallback、provider-specific retry。
- 成本、usage、callback、日志。
- OpenAI-compatible response 对外兼容。

MMD 不再重复实现这些 gateway 能力。

### 3.2 MMD 负责的边界

MMD 应该负责：

- 将用户请求转换成协商任务。
- 调用 LiteLLM 发起 panel / coordinator / compose 调用。
- 对每个阶段做结构化输出校验和修复。
- 维护 run 内部的 claim、candidate、vote、classification 数据结构。
- 对模型失败执行 quorum 降级。
- 生成最终回答和可选的 trace metadata。

换句话说，MMD 从“产品后端”转成“协议执行引擎”。

## 4. 与现有 TypeScript 实现的关系

现有 TypeScript monorepo 不废弃，但角色改变。它是协议验证场、测试基线和迁移参考，不是 LiteLLM 集成版必须长期兼容的正式 runtime。

### 4.1 保留为参考实现

以下模块继续作为协议参考实现和回归测试来源：

- `packages/protocol`：schema、共识分类、quorum、budget、id。
- `packages/prompts`：各阶段 prompt 构造。
- `packages/model-adapters`：fan-out、timeout、retry 的已验证行为。
- `apps/cli`：mock provider、真实 OpenAI-compatible endpoint 的端到端验证入口。

这些模块可以继续用于对照 Python port 是否行为一致。

如果后续 Python/LiteLLM 实现与 TypeScript 实现发生取舍冲突，优先保持 LiteLLM 版本的简洁和可维护。TypeScript 代码可以反向跟随 LiteLLM 版本调整，而不是要求 LiteLLM 版本继承所有历史形态。

### 4.2 LiteLLM upstream 目标需要 Python 实现

如果目标是进入 `BerriAI/litellm`，核心实现必须迁移为 Python：

- Zod schema -> Pydantic model。
- TypeScript orchestrator -> async Python orchestrator。
- `ModelProvider.complete` -> `litellm.acompletion` / Router 调用。
- `fanOutWithQuorum` -> `asyncio.gather(return_exceptions=True)` + quorum 判定。
- `callStructured` -> JSON extraction + Pydantic validation + repair retry。

不建议在 LiteLLM upstream 中引入 Node 子进程或 TypeScript runtime。那会让部署、错误传播、observability 和依赖管理都变复杂，也不符合 LiteLLM 的项目风格。

## 5. 新的 LiteLLM 接入形态

第一版可以用 custom provider / custom handler 做 proof of concept，但实现形态要从一开始就按 LiteLLM upstream 可接受的方式组织。PoC 的目的不是发展一个长期外部 adapter，而是降低正式 provider/router PR 的不确定性。

### 5.1 虚拟模型

建议暴露一个虚拟 provider：

```yaml
model_list:
  - model_name: mmd-fusion
    litellm_params:
      model: mmd/fusion
      analysis_models:
        - openai/<model>
        - anthropic/<model>
        - gemini/<model>
      coordinator_model: openai/<model>
      mmd_mode: standard
```

用户侧仍然按普通 chat completion 调用：

```json
{
  "model": "mmd-fusion",
  "messages": [
    { "role": "user", "content": "Compare Java Spring Boot and NestJS for a small e-commerce backend." }
  ]
}
```

### 5.2 请求参数

第一版建议支持以下参数。命名优先贴近 LiteLLM / OpenRouter Fusion 用户已经理解的词汇；MMD 内部术语只在 trace 和高级文档里出现。

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `analysis_models` | `list[str]` | 必填或 preset | 参与 panel 的模型。建议 1-8 个，与 Fusion 的心智模型接近。 |
| `coordinator_model` | `str` | `analysis_models[0]` | Normalize / Compose 使用的模型。 |
| `mmd_mode` | `quick | standard | planning` | `standard` | 协商策略。 |
| `quorum_ratio` | `float` | `0.66` | 每个 fan-out 阶段最低响应比例。 |
| `per_model_timeout` | `float` | 根据 mode | 单模型阶段超时。 |
| `max_repair_attempts` | `int` | `2` | 结构化 JSON 修复重试次数。 |
| `max_topics` | `int` | `8` | planning mode 的最大 topic 数。 |
| `return_trace` | `bool` | `false` | 是否在 metadata 中返回 claims/reviews/votes/classifications。 |
| `return_analysis` | `bool` | `false` | 是否在 message content 之外返回 Fusion-like structured analysis。 |

第二版再考虑：

- `preset`：展开为一组 panel models 和 coordinator。
- `max_completion_tokens`：转发给 panel/coordinator 调用。
- `temperature`：转发给 panel 调用；coordinator 默认低温。
- `reasoning`：透传给支持 reasoning config 的 provider。
- `tools` / web search：让 panel/coordinator 可用工具。

### 5.3 响应格式

默认响应必须保持 OpenAI-compatible，这是比展示 MMD 内部结构更高的优先级：

```json
{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "model": "mmd-fusion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Final answer text..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 0,
    "completion_tokens": 0,
    "total_tokens": 0
  }
}
```

当 `return_trace=true` 时，可以把 MMD 的额外结构放进 provider-specific metadata，而不是破坏 `choices[].message.content`。如果 LiteLLM 现有类型或 logging 管线更适合另一种字段名，应优先采用 LiteLLM 约定，而不是坚持 `mmd` 这个字段名：

```json
{
  "mmd": {
    "run_id": "run_...",
    "mode": "standard",
    "quorum": {
      "propose": { "respondent_count": 3, "required": 2, "partial": false },
      "vote": { "respondent_count": 2, "required": 2, "partial": true }
    },
    "classifications": {
      "candidate_1": {
        "label": "qualified_consensus",
        "approve_ratio": 0.66,
        "partial": true
      }
    },
    "candidate_claims": [
      {
        "candidate_id": "candidate_1",
        "text": "...",
        "source_claim_ids": ["model_a::c0", "model_b::c1"]
      }
    ]
  }
}
```

如果 LiteLLM 的 response object 对 metadata 字段有限制，则第一版可以采用三种降级方式，按优先级排序：

- 使用 LiteLLM callback/logging 记录 trace，不在默认响应中返回。
- 使用 LiteLLM 允许的 provider-specific metadata 字段返回压缩 trace。
- 在 `choices[0].message.content` 后追加一个显式 opt-in 的 Markdown trace section。

默认不应把完整 trace 塞进 content，否则普通用户会得到过长、难读且 token 成本偏高的回答。

## 6. 模式映射

### 6.1 quick

适合成本敏感和低延迟场景。

流程：

```text
Propose -> Normalize -> Compose
```

特点：

- 不跑 critique / revise / vote。
- 使用 candidate 的 `source_claim_ids` 覆盖范围推断隐式 approve。
- 返回速度更接近 Fusion 的单轮 panel 模式。
- 适合作为 LiteLLM 第一版默认体验的候选。若 upstream 接受度要求更轻量，quick 可以先于完整 standard 合入；完整 vote 协议作为高级模式补上。

### 6.2 standard

适合高价值问题和技术权衡。

流程：

```text
Propose -> Critique -> Revise -> Normalize -> Vote -> Compose
```

特点：

- 保留 MMD 核心差异化。
- 显式 vote 进入 `classifyCandidate`。
- 单模型失败通过 quorum 降级。
- 成本约为 N 个 panel 模型乘以多个阶段，不适合作为所有请求的隐式默认。

### 6.3 planning

适合长输出、技术规划、架构决策。

流程：

```text
Outline -> per-topic standard deliberation in parallel -> deterministic executive summary
```

特点：

- 先拆 topic，再对每个 topic 独立跑完整协议。
- 能避免单个超大 claim 池导致 critique 成本失控。
- 真实测试中，具体技术决策更容易触发有意义的 disputed 结果。
- LiteLLM 第一版可以先不启用，第二阶段作为差异化能力推出。planning 很有 MMD 价值，但不应阻塞最小 provider 合入。

## 7. 递归保护

Fusion 有递归保护，因为 panel/judge 模型如果再次触发 fusion，会造成无界调用。MMD 接入 LiteLLM 后也必须有同类保护。

建议方案：

- 内部调用时注入 metadata/header：`x-mmd-deliberation-depth: 1`。
- 如果请求已带 `x-mmd-deliberation-depth >= 1`，则禁止再次进入 MMD provider。
- 内部 panel/coordinator 调用必须使用真实底层模型，而不是再次使用 `mmd/fusion` alias。
- 如果用户配置的 `analysis_models` 包含 `mmd/fusion`，启动时直接报配置错误。

## 8. 错误和降级策略

LiteLLM integration 必须保留 M0 的降级原则：

- 单个模型失败不应让整个 run 失败。
- 某个 fan-out 阶段达到 quorum 时继续执行，并在 trace 中标记 `partial=true`。
- 未达到 quorum 时返回明确错误，错误中包含失败模型和阶段。
- Normalize / Compose 是单 coordinator 调用，第一版可以按普通异常失败；第二版再考虑 coordinator fallback。

错误映射建议：

| MMD 错误 | LiteLLM / OpenAI-compatible 映射 |
|---|---|
| provider auth/rate limit | 保留 LiteLLM 原 provider exception |
| structured output repair exhausted | `APIError` 或 provider-specific bad response error |
| quorum not met | `APIError`，message 包含 phase/respondent/required |
| invalid MMD config | `BadRequestError` |
| recursive MMD invocation | `BadRequestError` |

## 9. 成本和 latency 取舍

MMD 的完整协议不应该被包装成“免费增强”。文档和配置必须明确成本。

大致调用数量：

- `quick`：N 个 propose + 1 normalize + 1 compose。
- `standard`：N propose + N critique + N revise + 1 normalize + N vote + 1 compose。
- `planning`：1 outline + 每个 topic 一次 standard，但 topics 并行。

这意味着：

- `standard` 成本明显高于 OpenRouter Fusion 默认的 panel + judge + outer answer。
- `planning` 的 wall-clock latency 主要取决于最慢 topic，但总 token 成本接近 topic 数乘以 standard。
- LiteLLM integration 必须支持预算和熔断，例如最大 topic 数、最大模型数、per-model timeout、max tokens。

## 10. 与 LiteLLM upstream 的兼容原则

这个 branch 的实现应优先满足 LiteLLM 项目风格。以下原则优先级高于保留 MMD 当前 repo 的内部抽象：

- Python-first，不引入 Node runtime。
- 以 async implementation 为主，sync wrapper 可以后补。
- 使用 LiteLLM 现有 completion / router / callback / exception 体系。
- 不绕过 LiteLLM 的 cost tracking 和 logging。
- 默认 response 保持 OpenAI-compatible。
- 额外 trace 信息默认关闭，避免破坏普通 chat completion 用户体验。
- 单元测试覆盖 mock provider、partial quorum、structured repair、递归保护、配置错误。
- 配置、异常、日志字段命名尽量沿用 LiteLLM 现有约定。
- 如果 LiteLLM 已有 helper、类型或 callback 机制，不新增平行机制。

## 11. 新里程碑

### M2'：LiteLLM-native compatibility spike

目标：

- 明确 LiteLLM custom provider / native provider 的最小接入方式。
- 设计最贴近 LiteLLM 配置习惯的 `mmd/fusion` 或等价模型别名结构。
- 用 mock completion 跑通一个 OpenAI-compatible response。
- 从一开始按 upstream PR 形态组织代码和测试，即使第一轮先留在本 repo。

验收：

- 有一份最小 custom handler 或 provider 示例。
- 用户可以通过 LiteLLM proxy 调用 `model: mmd-fusion`。
- 不要求真实多模型完整协议。

### M2.1：Python protocol port

目标：

- 将 schema / quorum / consensus / structured repair 移植为 Python。
- 行为与 TypeScript 测试保持一致。

验收：

- Pydantic models 覆盖现有六阶段结构。
- consensus 测试覆盖 3/5/7 模型。
- critical / major objection 规则与 TypeScript 一致。

### M2.2：Python orchestrator

目标：

- 用 `litellm.acompletion` 实现 quick 和 standard。
- 保留 fan-out quorum 和 partial trace。

验收：

- mock 模型可跑通 quick / standard。
- 单模型失败时 quorum met -> run completed with partial。
- quorum not met -> typed error。

### M2.3：LiteLLM provider integration

目标：

- 把 orchestrator 包装成 LiteLLM custom provider 或 native provider。
- 支持基本 config 和 OpenAI-compatible response。
- 内部真实模型调用必须走 LiteLLM completion/router，不直接维护 provider HTTP adapter。

验收：

- LiteLLM proxy 可调用 `mmd-fusion`。
- `analysis_models` / `coordinator_model` / `mmd_mode` 生效。
- `return_trace=false` 时响应像普通模型。
- `return_trace=true` 时可审计 candidate/source/vote/classification。

### M2.4：planning mode and advanced config

目标：

- 移植 planning mode。
- 增加 preset、预算、max topics、递归保护。

验收：

- planning mode 可对多 topic 并行运行。
- topic 级 partial/failure 不拖垮整个 plan。
- recursive invocation 被拒绝。

### M2.5：upstream readiness

目标：

- 将 PoC 整理成可提交 LiteLLM 的 PR 形态；如果外部 package 更利于先传播，也必须保持 LiteLLM-native 安装和配置体验。

验收：

- 代码目录、测试、文档符合 LiteLLM 风格。
- 不依赖本 repo 的 TypeScript runtime。
- 提供配置示例和成本/限制说明。
- 能用 LiteLLM 用户熟悉的概念解释，不要求用户先理解 MMD monorepo。

## 12. 暂停或降级的原计划

以下原计划在本 branch 中暂停作为主线。除非它们能直接服务 LiteLLM provider 的采用，否则不应恢复为主任务：

- NestJS / Node Backend API。
- Postgres conversation/run persistence。
- SSE run event stream。
- Web MVP。
- 用户账号、分享链接、独立产品化 UI。

这些能力不是永远放弃，而是降级为后续可能的旁路：

- 如果 LiteLLM integration 成功，Web UI 可以变成 demo / trace viewer，而不是主产品入口。
- 如果需要持久化 trace，应优先考虑 LiteLLM callback/logging 集成，而不是先自建数据库。
- 如果要做管理界面，应复用 LiteLLM proxy/admin 的模型和 key 管理能力。
- 如果某项 MMD 能力会让 LiteLLM 默认体验变复杂，应改成 opt-in 或后续扩展，而不是阻塞核心 provider。

## 13. 当前 branch 的工程任务清单

已落地的 PoC 基线：

- `python/mmd_litellm` 已新增 LiteLLM-shaped Python/Pydantic PoC。
- 支持 `mmd/fusion` custom provider 外壳、`custom_provider_map` 配置示例、quick mode（Propose -> Normalize -> Compose）、standard mode（完整六阶段）、quorum/partial、run-scoped claim id、structured repair、递归保护和 `return_trace` metadata。
- 已新增本地 LiteLLM Proxy HTTP smoke：`uv run --project python --extra proxy python python/scripts/proxy_smoke.py`，使用 scripted mock panel 验证 `/chat/completions` 能调用 `model: mmd-fusion-mock`，无需真实模型 key。
- Python 行为测试覆盖 consensus、quorum、quick/standard orchestrator、provider response shape 和递归保护；运行方式：`uv run --project python --extra test pytest`。

短期任务：

- 用真实模型配置跑通 Proxy 调用 `model: mmd-fusion` 的 smoke test。
- 将 quick mode 的 mock client 测试升级为 LiteLLM `mock_response`/Router 风格测试，贴近 upstream review 习惯。
- 明确 `return_trace=true` 在 LiteLLM ModelResponse / callback logging 中的最终字段位置。
- 迁移 planning mode 的 outline / per-topic standard orchestration。

中期任务：

- 跑通 standard mode。
- 接入 LiteLLM Router 而不是直接请求 provider。
- 实现 custom provider。
- 增加 trace metadata。
- 增加递归保护。
- 将异常、usage、callbacks 接入 LiteLLM 现有机制。

后续任务：

- planning mode。
- web/tool/search 支持。
- provider-specific token usage 聚合。
- 文档、示例、upstream PR。
- 如 upstream 暂不接受，发布为 LiteLLM-native external provider，而不是回到自建产品路线。

## 14. 风险

### 14.1 LiteLLM response metadata 容纳能力

MMD 的 trace 结构很大，可能不适合直接返回。需要确认 LiteLLM response object 对 provider-specific metadata 的支持程度。如果不稳定，第一版应把 trace 放入 callback/logging 或可选 Markdown appendix。

### 14.2 成本可能高于用户预期

完整 standard 模式调用次数多。必须在配置和文档里明确成本，并提供 quick mode、max models、max topics、timeout、token limit。

### 14.3 Structured output 在不同 provider 上不稳定

现有 TypeScript 已经通过 repair retry 缓解，但 Python port 必须保留这一层。后续可以考虑利用 LiteLLM 对 response_format / JSON mode 的 provider 适配。

### 14.4 Tool/web search 能力缺口

OpenRouter Fusion 的实用性部分来自 panel/judge 可用 web_search/web_fetch。MMD 目前主要是纯推理协议。进入 LiteLLM 后，应把 tool calling / web search 列为第二阶段能力，否则在 research 类任务上会弱于 Fusion。

### 14.5 Upstream 接受度

LiteLLM 可能更偏好 provider/router 小而薄的集成，不一定接受复杂协议核心直接进入主仓库。PoC 应保持模块边界清晰，必要时先作为外部 package + custom provider 存在。

缓解方式：

- 第一版尽量小：quick/standard minimum viable provider 先行。
- planning、完整 trace viewer、web/tool search 都可以后置。
- 文档用 LiteLLM 用户熟悉的 router/provider 语言描述，不把 MMD 的历史产品路线带进 PR。
- 代码避免跨语言 runtime 和独立服务依赖。

## 15. 非目标

本 branch 不以以下事项为第一阶段目标：

- 构建新的 SaaS 产品。
- 构建新的独立 Web UI。
- 替代 LiteLLM 的 Router / fallback / logging。
- 实现完整 OpenRouter Fusion API 兼容。
- 默认返回完整内部推理链或冗长 trace。
- 让所有请求自动进入 MMD；调用方必须显式选择 `mmd/fusion` 或开启对应 provider。
- 保持 TypeScript CLI 与 LiteLLM provider 的功能完全同步。
- 维护一个与 LiteLLM 配置风格不同的 MMD 专属配置系统。

## 16. 成功标准

这个转向成功的最低标准：

- 用户能通过 LiteLLM proxy 调用一个虚拟 `mmd-fusion` 模型。
- 请求和响应对普通 OpenAI-compatible client 透明。
- 内部至少支持 quick 和 standard 两种模式。
- 单模型失败可 partial 完成，未达 quorum 有明确错误。
- 可选 trace 能追溯 candidate -> source claims -> votes -> classification。
- 实现不依赖 Node runtime，具备进入 LiteLLM upstream 或外部 custom provider 的可能性。
- 默认调用体验足够 LiteLLM-native：安装、配置、调用、错误排查都像一个普通 LiteLLM provider/router，而不是像启动另一个系统。
