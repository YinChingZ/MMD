# MMD — Multi-Model Deliberation

[![CI](https://github.com/YinChingZ/MMD/actions/workflows/ci.yml/badge.svg)](https://github.com/YinChingZ/MMD/actions/workflows/ci.yml)

*[English](README.en.md)*

多个 LLM 按 `mmd.v3` 协议进行协商式对话，输出带共识强度、完整制品血缘和调用审计的最终答案。

## 现状

当前新执行统一写入 `mmd.trace.v3`。Quick 固定 centralized N=2；Standard
支持 centralized，并可通过版本化 experiment manifest 启用实验性的 distributed
Align/complete-link；Planning 使用每主题 ledger 和唯一一次 GlobalCompose。

- **M0** 协议加固 · **M1** CLI 原型 · **M1.5** 收敛验证（Go 决策）· **v0.2** Planning Mode
- **M2** Backend API · **M3** Web MVP · **M4** BYOK 平台
- **M5** 项目收尾与生产就绪：成本熔断 · CI · 限流与数据清理 · 部署文档/Dockerfile · 分享链接
- **M6**（🚧 规划中）能力扩展：流式输出 · 工具调用 · 多模态输入 · 自定义 JSON 输出 —— 设计见 [docs/streaming-tools-multimodal-json.md](docs/streaming-tools-multimodal-json.md)，实施顺序拆成 M6.1–M6.6

三种运行模式：`standard`、`quick`、`planning`。代码结构：`apps/cli`（命令行）、`apps/api`（Fastify + Postgres，Conversation/Run API + SSE 事件流）、`apps/web`（Next.js 前端），核心编排逻辑抽在 `packages/orchestrator`，CLI 与 API 共用同一份实现。BYOK 让用户从受限 provider 白名单里选厂商、自带 API key 跑协商（匿名 workspace、cookie 识别、可选加密保存），每个 run 有成本上限（默认 $5）在超阈值时于下一阶段前熔断。

每个里程碑的设计取舍、刻意的架构偏离、真实测试发现和踩过的坑，详见 [docs/roadmap.md](docs/roadmap.md) —— 开发历史与里程碑的唯一出处。

## 六阶段协议

| 阶段 | 说明 |
|------|------|
| Propose | 每个模型只看到用户问题，独立回答，拆成若干 claims |
| Critique | 每个模型评议其他模型的 claims |
| Revise | 每个模型根据评议更新自己的立场 |
| Normalize | 合并语义相近的 claims 成 candidate claims（必须保留 `source_claim_ids` 以便追溯） |
| Vote | 每个模型对 candidate claims 表决 |
| Compose | 按比例制共识分类（strong / qualified / disputed / rejected）生成最终答案 |

`standard` 使用完整 ledger；`quick` 只跑 Propose/Normalize/Classify/Compose；
`planning` 在 Outline 后并行生成每主题 ledger，并只调用一次 GlobalCompose 形成
跨主题权威输出。Compose 失败不会改变确定性 classification ledger。

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
benchmarks/
  hle/                  # 适配 centerforaisafety/hle：导出 HLE 数据、生成 MMD predictions，并交给官方 judge 评分
docs/
  protocol.md           # 协议规则（六阶段 schema、共识、quorum、budget、Planning Mode）
  roadmap.md            # 开发规划与里程碑（含真实测试发现，开发历史的唯一出处）
  deployment.md         # 部署指南（Docker Compose / Railway）
  prior-art.md          # 竞品与相关工作对比
  streaming-tools-multimodal-json.md  # 未来能力的可行性分析（尚未实现）
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

会先跑一次 outline，把问题拆成最多 8 个主题并补充固定的跨主题风险主题；各主题并行完成 ledger，最后执行一次带 candidate/span 血缘的 GlobalCompose。

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

不存在 `apps/api/models.config.json` 时同样会退回 `MockProvider`（行为与 CLI 一致）。`ENCRYPTION_KEY` 环境变量必填（`openssl rand -base64 32` 生成），用于加密用户选择保存的 BYOK key，见 `.env.example`。核心接口：

| 接口 | 说明 |
|------|------|
| `GET /api/models` | 列出服务端可选模型（`id`/`providerLabel`/`isCoordinator`） |
| `GET /api/providers` | 列出 BYOK 白名单 provider（`providerId`/`displayName`，不下发 baseUrl；含可选 `suggestedRate`，供前端预填自定义计价输入框） |
| `POST /api/conversations` | 创建会话（按访问者的匿名 workspace cookie 打标） |
| `GET /api/conversations` | 列出当前 workspace 的会话（按最近活跃排序，其他 workspace 不可见） |
| `GET /api/conversations/:id` | 查看会话及其下的 run 列表（非本 workspace 返回 404） |
| `POST /api/conversations/:id/runs` | 发起一次协商 run（`question`/`mode`/可选 `governance`/实验性的 `experimentManifest`/`modelIds`/`byokModels`/`costLimitUsd`）；非法治理组合和 Quick 非 N=2 请求返回结构化错误。 |
| `GET /api/runs/:id` | 查询 run 状态 |
| `GET /api/runs/:id/result` | 获取最终结果（run 未完成时返回 409），含 `cost: {totalUsd, limitUsd, hasUnknownPricing}` |
| `GET /api/runs/:id/trace` | 获取独立持久化的 `mmd.trace.v3` 快照；运行中或失败的 run 也可读取已完成制品 |
| `GET /api/runs/:id/events` | SSE 事件流，支持按 `Last-Event-ID` 断线重连回放 |
| `GET /api/workspace/keys` | 列出当前 workspace 已保存的 BYOK key 元数据（provider/model/label，从不返回明文） |

## Web MVP（M3）

```bash
cd apps/web
cp .env.example .env      # API_BASE_URL 默认指向 http://localhost:3000
npm run dev                # 端口 3001，通过 rewrites 同源代理 /api/* 到 apps/api
```

浏览器打开 `http://localhost:3001`：新建会话、输入问题、选模式（`standard`/`quick`/`planning`）和模型、提交后实时看阶段进度（SSE），完成后展示最终答案、共识面板（可展开查看合并前的原始 claims）、按阶段折叠的讨论过程。`planning` 模式额外展示 outline 步骤和每个主题独立的进度条。开发环境下 `next.config.ts` 显式关闭了 Next 的内置 gzip 压缩（`compress: false`）——开启的话会缓冲被代理的 SSE 响应，导致运行进度收不到实时更新，是真实测试中发现的坑。

模型列表下方是"Add your own API key"（M4 BYOK）：从白名单选 provider（OpenAI/DeepSeek/OpenRouter/Volcengine）、填自己的 API key 和模型 id，加入本次 run；可选"记住这个 key"把它加密保存在这台设备的匿名 workspace 下，下次访问在"Saved keys on this device"里一键复用，浏览器不需要再次持有明文。旁边有一组可选的自定义计价输入（$/1M tokens，输入/输出各一个），预填了服务端算出的建议值（换 provider 会联动更新），可以直接接受、手动改成自己知道的真实价格，或清空——因为内置汇率表终究是个会过时的静态快照，让实际付费的人自己填一个更准，勾选"记住"时会跟着 key 一起持久化。

提交按钮上方是成本上限（M5.1，默认 $5，可编辑）：run 跨阶段累加每次模型调用的实际花费（有自定义计价的模型按用户填的算，其余按内置近似表或 OpenRouter 的真实回传成本算），一旦超过这个上限就在下一阶段开始前停止 run（不会等到全部跑完才失败），完成后的结果里也会显示实际花费。

## 开发

```bash
npm run test    # 各 workspace 的单元测试（apps/api 的集成测试需要 DATABASE_URL，未设置时会跳过）
npm run build   # 各 workspace 的 TypeScript 构建
```

## 相关文档

**规范与现状**（描述系统当前的样子）
- [docs/protocol.md](docs/protocol.md) — 协议规则的落地说明（六阶段、共识分类、quorum、budget、Planning Mode）
- [docs/deployment.md](docs/deployment.md) — 部署指南（Docker Compose / Railway，环境变量与密钥管理）
- [docs/prior-art.md](docs/prior-art.md) — 与 OpenRouter Fusion Router、litesquad、LiteLLM 生态的对比分析

**开发规划与未来**（描述怎么走到这一步、以及下一步）
- [docs/roadmap.md](docs/roadmap.md) — 里程碑规划、风险对照表与真实测试记录（开发历史的唯一出处）
- [docs/streaming-tools-multimodal-json.md](docs/streaming-tools-multimodal-json.md) — 流式输出/工具调用/多模态输入/自定义 JSON output 的设计与实施路径（**M6 的设计依据**，规划中）
