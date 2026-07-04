# MMD — Multi-Model Deliberation

多个 LLM 按 Propose → Critique → Revise → Normalize → Vote → Compose 六阶段协议进行协商式对话，输出带共识强度标注、且可追溯到原始论点的最终答案。

## 现状

当前仓库处于 **M0（协议加固）+ M1（CLI 原型）** 阶段：协议层已实现并有测试覆盖，`apps/cli` 可以用 mock provider 或真实的 OpenAI 兼容 API 端到端跑通一次协商并输出 JSON/Markdown 报告。Backend API（M2）和 Web MVP（M3）尚未开始。详见 [multi-model-deliberation-dev-roadmap.md](multi-model-deliberation-dev-roadmap.md)。

## 六阶段协议

| 阶段 | 说明 |
|------|------|
| Propose | 每个模型只看到用户问题，独立回答，拆成若干 claims |
| Critique | 每个模型评议其他模型的 claims |
| Revise | 每个模型根据评议更新自己的立场 |
| Normalize | 合并语义相近的 claims 成 candidate claims（必须保留 `source_claim_ids` 以便追溯） |
| Vote | 每个模型对 candidate claims 表决 |
| Compose | 按比例制共识分类（strong / qualified / disputed / rejected）生成最终答案 |

协议的硬性约束（比例制共识、run 隔离的 id、quorum 降级、延迟/成本预算、quick mode）见 [docs/protocol.md](docs/protocol.md)。

## Monorepo 结构

```
apps/
  cli/                 # M1：跑通全流程的命令行入口
packages/
  protocol/             # zod schema + 共识分类 / quorum / id / budget 纯函数
  model-adapters/       # provider 封装：mock、OpenAI 兼容、按 quorum 的 fan-out
  prompts/              # 六阶段的 prompt 构造
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
| `--mode` | `standard`（默认，六阶段全跑）或 `quick`（跳过 critique/revise/vote） |
| `--models`, `-m` | 使用 mock provider 时的模型 id 列表，逗号分隔 |
| `--fail-models` | 使用 mock provider 时指定模拟失败的模型 id，用于测试 quorum 降级 |
| `--config`, `-c` | models config 路径，默认 `./models.config.json` |
| `--provider mock` | 强制使用 mock provider，即使存在 config 文件 |
| `--out`, `-o` | 输出目录，默认 `./out` |

## 开发

```bash
npm run test    # 各 workspace 的单元测试
npm run build   # 各 workspace 的 TypeScript 构建
```

## 相关文档

- [docs/protocol.md](docs/protocol.md) — 协议规则的落地说明
- [multi-model-deliberation-dev-roadmap.md](multi-model-deliberation-dev-roadmap.md) — 里程碑规划与风险对照表
