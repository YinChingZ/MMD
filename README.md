# MMD — Multi-Model Deliberation

MMD 让多个 LLM 围绕同一问题进行结构化协商，并生成带共识强度、分歧和可追溯来源的最终回答。它的目标是成为 LiteLLM 生态中可自托管的多模型 deliberation provider，而不是重建 LiteLLM 的 gateway、路由或治理能力。

## 文档

项目只有三份权威主文档：

1. **本文件**：定位、仓库入口和快速开始。
2. [架构与运行参考](docs/architecture.md)：协议、LiteLLM Provider、配置、返回契约、限制和验证命令。
3. [统一开发路径](docs/development.md)：当前状态、所有后续阶段、验收标准、发布与 LiteLLM upstream 路线。

`docs/research/` 是带日期的调研归档，不定义当前行为或开发优先级；`python/README.md` 仅用于 Python 包发布元数据。

## 当前状态

TypeScript 协议核心和 CLI 已完成，支持 `quick`、`standard` 与 `planning` 三种模式。Python `mmd-litellm` 包可作为 LiteLLM custom provider 暴露 `mmd/fusion`，并已覆盖 Router 注入、quorum、trace、usage 聚合、超时和调用预算。

它**尚未达到 OpenRouter Fusion 的完整产品级能力**：没有默认自动 panel、按需 deliberation 策略、端到端 tool loop、完整消息保真或 streaming。当前边界和完成路径以 [统一开发路径](docs/development.md) 为准。

## 仓库结构

```text
apps/cli/                 TypeScript CLI 原型
packages/protocol/        Zod schema、共识/quorum/id/budget 纯函数
packages/model-adapters/  OpenAI-compatible 与 mock provider、fan-out
packages/prompts/         协商阶段的 prompt 构造
python/mmd_litellm/       LiteLLM custom provider 与 Pydantic 协议实现
python/examples/          Proxy 配置和 handler shim 示例
docs/                     三份权威文档与非权威研究归档
```

## 快速开始

安装依赖并运行无 API key 的 mock 协商：

```bash
npm install
cd apps/cli
npm run start -- --question "Should a small team adopt a monorepo?" --mode standard
```

不存在 `models.config.json` 或传入 `--provider mock` 时，CLI 使用三个 scripted mock 模型。输出写入 `apps/cli/out/<runId>.json` 和 `.md`。

使用真实 OpenAI-compatible 模型：

```bash
cp apps/cli/models.config.example.json apps/cli/models.config.json
cp apps/cli/.env.example apps/cli/.env
```

在 `models.config.json` 中配置模型与 endpoint，并在 `.env` 中设置相应 key。两个本地配置均被 `.gitignore` 排除。

LiteLLM Proxy 的安装、YAML 示例、可用选项及 smoke test 见 [架构与运行参考](docs/architecture.md#litellm-provider)。

## 常用命令

```bash
npm run test
npm run build
uv run --project python --extra test pytest
uv run --project python --extra proxy python python/scripts/proxy_smoke.py
```

真实模型 smoke 需要环境变量中的 provider key，完整命令和安全要求见 [架构与运行参考](docs/architecture.md#验证)。
