# MMD — Multi-Model Deliberation

*[English](README.en.md)*

多个 LLM 按 Propose → Critique → Revise → Normalize → Vote → Compose 六阶段协议进行协商式对话，输出带共识强度标注、且可追溯到原始论点的最终答案。

## 现状

**M0（协议加固）+ M1（CLI 原型）+ M1.5（收敛验证，Go 决策）+ v0.2（Planning Mode 长输出支持）+ M2（Backend API）+ M3（Web MVP）均已完成**，且都用真实模型（不只是 mock）跑通过端到端验证。`apps/cli` 支持三种模式：`standard`（默认六阶段）、`quick`（跳过 critique/revise/vote）、`planning`（按主题拆分、支持综合技术规划这类长输出）。`apps/api` 把同一套 orchestrator 逻辑（现已提取为 `packages/orchestrator`，CLI 和 API 共用）搬到了 Fastify + Postgres 服务端：Conversation/Run API、SSE 事件流（断线重连可按 `Last-Event-ID` 回放）、run 结果持久化。`apps/web` 是消费这套 API 的 Next.js 前端：提问、选模型、实时看运行进度、展开查看共识背后的原始 claims、复制最终答案。下一步是 M4 产品化基础。详见 [multi-model-deliberation-dev-roadmap.md](multi-model-deliberation-dev-roadmap.md)（含真实测试的发现和数据）。

## 六阶段协议

| 阶段 | 说明 |
|------|------|
| Propose | 每个模型只看到用户问题，独立回答，拆成若干 claims |
| Critique | 每个模型评议其他模型的 claims |
| Revise | 每个模型根据评议更新自己的立场 |
| Normalize | 合并语义相近的 claims 成 candidate claims（必须保留 `source_claim_ids` 以便追溯） |
| Vote | 每个模型对 candidate claims 表决 |
| Compose | 按比例制共识分类（strong / qualified / disputed / rejected）生成最终答案 |

`standard`/`quick` 模式直接跑这六个阶段；`planning` 模式在最前面加一个 **Outline** 阶段（单一 coordinator 把问题拆成最多 8 个主题），然后对每个主题并行跑一遍这六阶段，最终按主题分节输出。

协议的硬性约束（比例制共识、run 隔离的 id、quorum 降级、延迟/成本预算、quick/planning mode、outline 阶段为什么用单一 coordinator）见 [docs/protocol.md](docs/protocol.md)。

## Monorepo 结构

```
apps/
  cli/                 # M1：跑通全流程的命令行入口
  api/                  # M2：Fastify + Postgres 后端（Conversation/Run API、SSE 事件流）
  web/                  # M3：Next.js 前端（问题输入、模型选择、运行进度、共识面板）
packages/
  protocol/             # zod schema + 共识分类 / quorum / id / budget 纯函数
  model-adapters/       # provider 封装：mock、OpenAI 兼容、按 quorum 的 fan-out
  prompts/              # 六阶段的 prompt 构造
  orchestrator/         # propose→critique→revise→normalize→vote→compose 的编排逻辑，CLI 和 API 共用
docs/
  protocol.md           # 协议规则文档
```

## 快速开始

```bash
npm install
```

### 用 mock provider 跑一次（无需 API key）

```bash
cd apps/cli
npm run start -- --question "Should a small team adopt a monorepo?" --mode standard
```

不存在 `models.config.json`（或传 `--provider mock`）时会自动使用 `MockProvider`，默认模拟 `model_a,model_b,model_c` 三个模型，不会发起真实网络请求。结果会写入 `apps/cli/out/<runId>.json` 和 `.md`，并打印到终端。

### Planning mode：长输出/综合技术规划

```bash
npm run start -- --question "给一个 3 人团队的电商项目做技术选型规划" --mode planning
```

会先跑一次 outline 把问题拆成最多 8 个主题，再对每个主题并行跑完整六阶段协议，最终输出一份按主题分节的规划文档（`## Executive Summary` + 每个主题一节）。真实模型下单个主题的六阶段耗时和 `standard` 模式的单次 run 类似（见 [docs/protocol.md](docs/protocol.md) 的真实耗时基线），多个主题并行执行，所以总耗时约等于最慢的那个主题，而不是耗时总和。

### 接入真实模型

```bash
cp apps/cli/models.config.example.json apps/cli/models.config.json
cp apps/cli/.env.example apps/cli/.env
```

编辑 `models.config.json`，为每个模型填入真实的 `modelId` / `baseUrl`（任意 OpenAI 兼容的 `/chat/completions` 端点），并在 `.env` 里设置对应 `apiKeyEnvVar` 指向的环境变量的值。两个文件都已加入 `.gitignore`，不会被提交。

### CLI 参数

| flag | 说明 |
|------|------|
| `--question`, `-q` | 待协商的问题 |
| `--mode` | `standard`（默认，六阶段全跑）、`quick`（跳过 critique/revise/vote）或 `planning`（按主题拆分，适合长输出/综合规划） |
| `--models`, `-m` | 使用 mock provider 时的模型 id 列表，逗号分隔 |
| `--fail-models` | 使用 mock provider 时指定模拟失败的模型 id，用于测试 quorum 降级 |
| `--config`, `-c` | models config 路径，默认 `./models.config.json` |
| `--provider mock` | 强制使用 mock provider，即使存在 config 文件 |
| `--out`, `-o` | 输出目录，默认 `./out` |

## Backend API（M2）

```bash
docker compose up -d postgres
cp apps/api/.env.example apps/api/.env      # 按需修改 DATABASE_URL/PORT
cd apps/api
npm run db:migrate
npm run start
```

不存在 `apps/api/models.config.json` 时同样会退回 `MockProvider`（行为与 CLI 一致）。核心接口：

| 接口 | 说明 |
|------|------|
| `GET /api/models` | 列出服务端可选模型（`id`/`providerLabel`/`isCoordinator`） |
| `POST /api/conversations` | 创建会话 |
| `GET /api/conversations` | 列出会话（按最近活跃排序） |
| `GET /api/conversations/:id` | 查看会话及其下的 run 列表 |
| `POST /api/conversations/:id/runs` | 发起一次协商 run（`question`/`mode`/可选 `modelIds`，模型必须来自服务端 `models.config.json` 里配置的 id，不接受客户端自带 provider/baseUrl） |
| `GET /api/runs/:id` | 查询 run 状态 |
| `GET /api/runs/:id/result` | 获取最终结果（run 未完成时返回 409） |
| `GET /api/runs/:id/events` | SSE 事件流，支持按 `Last-Event-ID` 断线重连回放 |

## Web MVP（M3）

```bash
cd apps/web
cp .env.example .env      # API_BASE_URL 默认指向 http://localhost:3000
npm run dev                # 端口 3001，通过 rewrites 同源代理 /api/* 到 apps/api
```

浏览器打开 `http://localhost:3001`：新建会话、输入问题、选模式（`standard`/`quick`/`planning`）和模型、提交后实时看阶段进度（SSE），完成后展示最终答案、共识面板（可展开查看合并前的原始 claims）、按阶段折叠的讨论过程。`planning` 模式额外展示 outline 步骤和每个主题独立的进度条。开发环境下 `next.config.ts` 显式关闭了 Next 的内置 gzip 压缩（`compress: false`）——开启的话会缓冲被代理的 SSE 响应，导致运行进度收不到实时更新，是真实测试中发现的坑。

## 开发

```bash
npm run test    # 各 workspace 的单元测试（apps/api 的集成测试需要 DATABASE_URL，未设置时会跳过）
npm run build   # 各 workspace 的 TypeScript 构建
```

## 相关文档

- [docs/protocol.md](docs/protocol.md) — 协议规则的落地说明
- [docs/prior-art.md](docs/prior-art.md) — 与 OpenRouter Fusion Router、litesquad、LiteLLM 生态的对比分析
- [multi-model-deliberation-dev-roadmap.md](multi-model-deliberation-dev-roadmap.md) — 里程碑规划与风险对照表
