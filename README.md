# MMD — Multi-Model Deliberation

[![CI](https://github.com/YinChingZ/MMD/actions/workflows/ci.yml/badge.svg)](https://github.com/YinChingZ/MMD/actions/workflows/ci.yml)

*[English](README.en.md)*

MMD 是一个 audit-first、claim-level 的多模型审议工作台。它保存 claim lineage、修订、异议、分类输入和调用审计，并用确定性规则计算支持标签，而不是让单个 judge 模型直接宣布“共识”。

## 当前协议

新运行使用 `mmd.v3` 并写入 `mmd.trace.v3`：

| Mode | Governance | 当前状态 | 核心路径 |
|---|---|---|---|
| Quick | centralized | 产品路径，严格 N=2 | Propose → Normalize → Classify → Compose |
| Standard-C | centralized | 默认/兼容路径 | Propose → Critique → Revise → Normalize → Vote → Classify → Compose |
| Standard-D | distributed/peer-governed | 实验性、manifest-gated | Propose → Critique → Revise → Align → complete-link → Vote → Classify → Compose |
| Planning | centralized | 产品路径 | Outline → 每主题 ledger → 一次 GlobalCompose |

host orchestrator 始终负责调度、ID、quorum、确定性分类、持久化和 failure semantics。LLM coordinator 只是在 Normalize、Compose、Outline 或 GlobalCompose 等指定阶段使用的模型角色。Standard-D 不是“没有 orchestrator”。

Planning v3 不再执行 per-topic SectionCompose。权威结果是单一 `PlanningFinalAnswer`；旧 `PlanDocument` 只作为现有 CLI/UI/reader 的兼容投影。

协议细节见 [docs/protocol.md](docs/protocol.md)，版本边界见 [docs/versioning.md](docs/versioning.md)。

## 项目状态

- **M0–M5**：协议加固、CLI、Backend API、Web MVP、BYOK、成本熔断、CI、清理、部署和分享链接均已完成。
- **M6.1–M6.6**：自定义 JSON、模型/claim 级流式进度、Compose 流式、多模态输入和可选 web search/tool path 已完成；历史设计与实测记录见 [docs/roadmap.md](docs/roadmap.md)。
- **Protocol v3**：Quick N=2、Standard-C/D、Planning GlobalCompose、trace v3 和独立 artifact persistence 已落地。
- **仍属 research target**：共享 post-revision root 的 CN/DN 2×2 runner、Standard-D deterministic-render/fidelity gate、显式 classification-basis kind、完整 prompt/provider version ledger，以及 main/LiteLLM 正式 parity gate。

## 为什么不只是“问 N 个模型再合并”

- **命题级审议**：长回答拆成 claims，归一后逐 candidate 表决和分类。
- **血缘是数据约束**：candidate 必须保存 `source_claim_ids`；Planning span 保存 candidate lineage。
- **分类与 prose 分离**：classification ledger 是权威结果，Compose 失败返回 deterministic fallback。
- **异议不会被静默吞掉**：objection severity 参与确定性分类。
- **失败保留中间制品**：trace/artifacts 与最终 run status 分开持久化。

这不意味着 coordinator 没有认知风险。Normalize 的 false merge/split、Compose 的 dispute laundering、模型身份偏差和共识校准仍是明确的研究问题，见 [docs/prior-art.md](docs/prior-art.md)。

## Monorepo

```text
apps/
  cli/                 # 命令行入口
  api/                 # Fastify + Postgres、Conversation/Run API、SSE、trace API
  web/                 # Next.js 工作台
packages/
  protocol/            # schema、classification、quorum、governance、trace v3
  model-adapters/      # mock/OpenAI-compatible/provider routing
  prompts/             # 各 phase prompt
  orchestrator/        # 所有 mode/governance 的共享 host orchestration
contract/
  mmd-protocol-v3/     # 语言无关 schema、errors 和 parity fixtures
benchmarks/
  hle/                 # HLE adapter
docs/                  # 协议、版本、历史、部署和竞品文档
```

## 快速开始

```bash
npm install
```

### Standard mock run

```bash
cd apps/cli
npm run start -- --question "Should a small team adopt a monorepo?" --mode standard
```

没有 `models.config.json` 或使用 `--provider mock` 时，CLI 默认模拟 `model_a,model_b,model_c`。

### Quick mock run

Quick v3 必须显式提供两个不同模型：

```bash
npm run start -- --question "Should a small team adopt a monorepo?" \
  --mode quick --models model_a,model_b
```

真实模型配置运行 Quick 时，配置文件也必须只选择两个模型。`Traceable-Quick-C@N3` 只能由研究 manifest/runner 运行，不是 CLI 产品默认。

### Planning run

```bash
npm run start -- --question "给一个 3 人团队的电商项目做技术选型规划" --mode planning
```

Planning 会生成 outline，补入固定的 `cross_cutting_risks_and_omissions` topic，并行完成每主题 ledger，最后执行一次带 span lineage 的 GlobalCompose。

### 真实模型

```bash
cp apps/cli/models.config.example.json apps/cli/models.config.json
cp apps/cli/.env.example apps/cli/.env
```

在配置文件中填写 OpenAI-compatible `baseUrl`/`modelId`，在 `.env` 中设置对应 key。两者均已被 `.gitignore` 排除。

### CLI 参数

| Flag | 说明 |
|---|---|
| `--question`, `-q` | 待审议的问题 |
| `--mode` | `standard`（默认）、`quick` 或 `planning` |
| `--models`, `-m` | mock provider 的模型 ID 列表；Quick 必须恰好两个 |
| `--fail-models` | mock provider 中模拟失败的模型 |
| `--config`, `-c` | models config 路径，默认 `./models.config.json` |
| `--provider mock` | 强制使用 mock provider |
| `--out`, `-o` | 输出目录，默认 `./out` |

## Backend API

```bash
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env
cd apps/api
npm run db:migrate
npm run start
```

主要接口：

| Endpoint | 说明 |
|---|---|
| `POST /api/conversations/:id/runs` | 创建 run；接受 `mode`、可选 `governance`、实验性 `experimentManifest`、模型/BYOK、成本上限和 M6 输入 |
| `GET /api/runs/:id` | run 状态、mode 和 `governance` |
| `GET /api/runs/:id/result` | 最终结果；Planning 同时包含权威 `planningFinal` 与兼容 `planDocument` |
| `GET /api/runs/:id/trace` | 读取运行中、完成或失败 run 已保存的 `mmd.trace.v3` snapshot |
| `GET /api/runs/:id/events` | 可按 `Last-Event-ID` 重放的 SSE 事件流 |

公共 API 请求沿用 camelCase；语言无关 contract/trace 使用 snake_case。

## Web MVP

```bash
cd apps/web
cp .env.example .env
npm run dev
```

访问 `http://localhost:3001`。当前 Web 支持会话、模型/BYOK、三种 mode、实时阶段/claim/Compose 进度、成本、共识与血缘、分享链接和 Planning 结果。Standard-D 目前没有普通产品 governance selector；它仍是通过 API experiment manifest 启用的实验路径。WebUI 的治理选择、Standard-D ledger 呈现和 Planning trace 重构属于独立 UI 工作。

## 开发与校验

```bash
npm run test
npm run build
```

Protocol v3 的跨实现 contract 位于 [contract/mmd-protocol-v3](contract/mmd-protocol-v3/README.md)。正式研究前，main 与 LiteLLM 必须通过相同 deterministic fixtures 的 phase、ID、candidate、ballot、classification、lineage、failure、quorum 和 usage parity。

## 文档

- [Protocol](docs/protocol.md) / [Protocol EN](docs/protocol.en.md) — 当前实现语义
- [Versioning](docs/versioning.md) / [Versioning EN](docs/versioning.en.md) — 版本和兼容规则
- [Prior art](docs/prior-art.md) / [Prior art EN](docs/prior-art.en.md) — 竞品、机制 baseline 与邻近生态
- [Roadmap](docs/roadmap.md) — 历史里程碑和实测记录
- [M6 historical design](docs/streaming-tools-multimodal-json.md) — M6 设计与历史 SectionCompose 记录
- [Deployment](docs/deployment.md) / [Deployment EN](docs/deployment.en.md) — 部署、迁移和密钥管理
