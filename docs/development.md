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

目前的验证基线：Python 69 tests、TypeScript 102 tests、各自构建通过；scripted Proxy smoke 和核心真实模型 smoke 已运行。真实 smoke 未保存质量、成本或 latency artifact，不能作为性能或效果基准。

## 当前工作：M2' upstream-readiness

M2' 的目标不是匆忙把 MMD 并入 LiteLLM，而是先形成可独立安装、可验证、符合 LiteLLM custom-provider 契约的外部包。按以下顺序推进，前一项未达到验收时不跳到后一项。

### P0 — 补齐 LiteLLM provider 契约

**目标**：使 `mmd-litellm` 成为可靠的 external custom provider。

**工作项**：

1. 显式实现 `completion`、`acompletion`、`streaming`、`astreaming`，使用 LiteLLM 当前签名与传入的 `ModelResponse`；去除以 `mock_response` 二次构造 response 的路径。
2. 定义 conversation adapter，保留 system/developer、多轮 assistant、tool result 和 text content parts；不支持的 multimodal 类型必须 fail-fast，不得静默丢弃。
3. 为 `stream=True` 实现诚实 streaming：先完成 deliberation，再产生最终答案 chunks，并标记首 token 前 deliberation 已完成。阶段事件若要暴露，使用独立事件协议而非伪装成 token。
4. 对 tools 做产品决策：短期显式拒绝，或提供标注为实验性的 passthrough；长期才实现受限 tool loop / result adapter。`max_total_calls` 应在语义上更名或补充全局 tool budget。
5. 添加 Proxy e2e：normal、stream、callback 仅一次、Router alias/fallback、native error、recursion、budget 和超时。

**验收**：所有支持路径具有 unit + Proxy test；所有不支持路径给出稳定的 4xx 错误；示例可在干净环境只通过安装包和 shim 启动。

### P1 — Fusion 级可用性差距

Fusion 是产品对照，不是应复制的私有实现。达到“Fusion-like”之前必须完成下列能力或清晰标明不支持：

| 缺口 | 目标验收 |
| --- | --- |
| 默认 panel | 一个可配置、provider-aware 的默认 panel / 单一配置对象；不硬编码用户 key 或厂商模型。 |
| deliberation policy | `off`、`required`、`auto`；`auto` 必须有可测试的决策机制。 |
| 工具/联网 | 至少一个端到端 tool/web 路径，带全局调用上限、result trace 和真实集成测试。 |
| 成本/性能 | 每个 panel/coordinator 的 tokens、估算成本、duration、成功率和 partial 状态。 |
| 兼容性 | 完整 chat turn、streaming、明确 tools 语义和稳定 response/metadata version。 |

MMD 的多轮 critique/revise/vote 是审计差异化，不等于用户可感知的 Fusion parity；默认体验必须先做到低摩擦、可控成本和诚实的能力边界。

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
