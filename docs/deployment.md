# 部署指南

*[English](deployment.en.md)*

本文档是 M5.4 的产出，描述如何把 `apps/api`（Fastify + Postgres）和 `apps/web`（Next.js）容器化并部署。此前唯一验证过的运行方式是本地 `npm run dev`/`npm run start` + Homebrew Postgres；这是第一条可复现的部署路径。

## Protocol v3 数据迁移与兼容

当前镜像的新运行使用 `mmd.v3`。部署时必须执行全部数据库 migration；
`0010_protocol_v3.sql` 会新增 run governance、`run_results.trace`、
`run_results.planning_final`、`run_traces` 和 `run_artifacts`，并把新 run 的
`protocol_version` 默认值改为 `mmd.v3`。现有旧 run 不会被重写或补造 v3 lineage。

API 启动命令已经在服务启动前运行幂等 migration。滚动发布时应先确认数据库
迁移成功，再让新进程接收请求。`GET /api/runs/:id/trace` 可读取运行中、完成或
失败 run 已保存的 snapshot；后续 phase 失败不会删除先前持久化的 artifacts。
版本和 legacy-read 规则见 [versioning.md](versioning.md)。

## 为什么两个 Dockerfile 都要从仓库根目录构建

`apps/api`/`apps/web` 都通过包名 import `packages/protocol`、`packages/orchestrator` 等——这是 npm workspaces 通过根目录 `node_modules` 里的符号链接（如 `node_modules/@mmd/protocol -> ../packages/protocol`）解析的。因此构建命令必须是：

```bash
docker build -f apps/api/Dockerfile .
docker build -f apps/web/Dockerfile .
```

注意结尾的 `.`（构建上下文是仓库根目录，不是 `apps/api`/`apps/web` 各自的目录），且必须用 `-f` 指定 Dockerfile 路径。

## 一个不那么直观、但实测验证过的架构决定：apps/api 在运行时不用编译产物

`apps/api/Dockerfile` 的 runtime 阶段最终是 `npm run start`（即 `tsx src/main.ts`），而不是常见的 `node dist/main.js`。这不是随手选的：`packages/*` 每个包的 `package.json` 的 `"main"`/`"types"` 字段直接指向各自的 `src/index.ts`（M5.1 时期的既有设计，为了让 vitest/tsx 不依赖一份可能过期的 dist——见 `roadmap.md`）。这意味着如果照搬"只拷贝 dist + node_modules + package.json，跑 `node dist/main.js`"这种常见做法，编译后的 `apps/api/dist/main.js` 在 `require("@mmd/protocol")` 时会顺着符号链接找到 `packages/protocol/src/index.ts`——一份没有编译过的 TypeScript 源文件，纯 Node.js 无法执行，会直接报 `ERR_MODULE_NOT_FOUND`（本项目实测复现过这个报错）。

解决办法是让 runtime 阶段跟 `npm start`/`npm run dev` 用同一条路径——通过 `tsx` 在运行时转译源码（apps/api 自己的代码和 workspace 包的代码都一样），而不是引入打包工具或者改动各包现有的 `"main"` 字段指向（改字段本身风险更大，会影响 vitest/tsx 已经确立的解析行为）。代价是 runtime 镜像里保留了完整的开发依赖（`typescript`、`vitest` 等），镜像体积比纯生产依赖大一些；这是刻意的取舍，换来的是不用碰这个 monorepo 里已经用一整个里程碑验证过的模块解析方式。

`apps/api/Dockerfile` 里仍然保留了 `tsc` 构建这一步，但只是构建期的类型检查关卡（构建失败就让镜像构建失败），runtime 阶段完全不会用到它的产物。

## apps/web 不需要这个顾虑

`apps/web` 对 `@mmd/protocol`/`@mmd/orchestrator` 的引用全部是 `import type`（纯类型，编译期擦除，运行时不留痕迹——这也是 M4 阶段发现 Turbopack 没法打包 workspace 包的真实运行时值之后，改成"前端只向 apps/api 发请求拿数据，不直接 import 运行时逻辑"的直接结果）。所以 `next.config.ts` 里的 `output: "standalone"` 产出的 `.next/standalone` 完全不含 `@mmd/*`（已实测确认），可以走 Next.js 标准的 standalone 部署方式，不需要任何特殊处理。

## 必需的环境变量

### apps/api（运行时环境变量，`docker run -e`/部署平台的环境变量面板均可）

| 变量 | 必需 | 说明 |
|------|------|------|
| `DATABASE_URL` | 是 | Postgres 连接串，如 `postgres://user:pass@host:5432/dbname` |
| `ENCRYPTION_KEY` | 是 | AES-256-GCM 密钥，加密 BYOK 用户选择保存的 API key。用 `openssl rand -base64 32` 生成，必须解码后正好 32 字节 |
| `PORT` | 否，默认 `3000` | 监听端口 |

### apps/web（**注意：`API_BASE_URL` 是构建期参数，不是运行期变量**）

| 变量 | 必需 | 说明 |
|------|------|------|
| `API_BASE_URL` | 否，默认 `http://localhost:3000` | apps/api 的地址。**只在 `next build` 时生效一次**，写入 `.next/routes-manifest.json` 的 rewrite 目标——Next.js 不会按请求重新求值 `rewrites()`。想指向不同的 API 地址，必须用不同的 `--build-arg API_BASE_URL=...` 重新构建镜像，`docker run -e API_BASE_URL=...` 不会有任何效果（这一点已经实测验证过：改运行时环境变量，manifest 里的目标地址不变）。 |
| `PORT` | 否，默认 `3000` | standalone `server.js` 监听端口 |

## 密钥管理：生产环境不要用明文 `.env`

`apps/api/.env.example`/根目录 `.env.example` 是本地开发/`docker compose` 场景用的，`.env`/`.env.local` 已经在 `.gitignore` 里。生产环境请使用部署平台自带的 secrets 管理（Railway 的 Variables 面板、Fly.io 的 `fly secrets set`、Render 的 Environment 面板等），不要把 `ENCRYPTION_KEY`、数据库密码这类值以明文文件形式打进镜像或提交到仓库。

`ENCRYPTION_KEY` 一旦投入使用后不要更换——现有实现没有做在线密钥轮换（见 M4 的"已知不在这次范围内的后续待办"），换密钥需要离线重新加密 `workspace_api_keys` 表里的所有行，否则已保存的 BYOK key 会解密失败。

## `models.config.json`（可选的服务端模型注册表）

默认情况下容器化的 `apps/api` 是纯 BYOK 模式——找不到 `models.config.json` 就退回 `MockProvider`（这正是本项目自 M4 起的主要定位：不需要运营方帮用户垫付模型调用成本）。如果你还想同时提供一份服务端预置的模型注册表（M2 时期的原始模式），需要把文件挂载到容器内 `apps/api` 的工作目录：

```bash
docker run -v $(pwd)/models.config.json:/app/apps/api/models.config.json ...
```

`docker-compose.yml` 里同理可以给 `api` 服务加一条 `volumes` 映射。这份文件不应该打进镜像本身（每次都要重新构建镜像才能改模型列表不现实），只能通过挂载/运行时注入。

## 本地验证：`docker compose up --build`

仓库根目录的 `docker-compose.yml` 现在除了本来就有的 `postgres` 之外，还有 `api`/`web` 两个服务，都是从各自的 Dockerfile 构建：

```bash
cp .env.example .env   # 填入 ENCRYPTION_KEY（openssl rand -base64 32）
docker compose up --build
```

- `postgres`：5432 端口，`api` 服务通过 `depends_on` + healthcheck 等它就绪。
- `api`：3000 端口，容器启动时先跑 `npm run db:migrate`（幂等，可重复执行）再 `npm run start`。
- `web`：映射到宿主机 3001 端口（容器内仍是 3000，避免和 `api` 的宿主机端口冲突），构建时通过 `args.API_BASE_URL: http://api:3000`（Docker Compose 内部 DNS，服务名即可解析）指向 `api` 服务。

跑起来后访问 `http://localhost:3001`，走一遍"创建会话 → 添加 BYOK key → 提交 run → 看到结果"的完整流程，验证容器化之后行为和 `npm run dev` 一致——这条流程已经用真正的 Docker（非模拟）跑通过一次，细节见下方"验收状态"一节。

## 生产环境必须用 HTTPS：一个实测验证过的坑

`middleware/workspace.ts` 签发的匿名 workspace cookie 在 `NODE_ENV=production`（Dockerfile 已设置）时会带上 `Secure` 属性——这是本来就有的行为，不是这次新加的。用真实 Docker 容器验证时确认了这一点：`docker compose` 跑起来后 `Set-Cookie` 头里确实带了 `Secure`。**这意味着如果生产环境不是走 HTTPS，真实浏览器根本不会把这个 cookie 存下来/带回来**（`curl` 不会帮你拦这个问题——它默认不遵守 `Secure` 语义，所以本文档下面用 `curl` 做的端到端验证不会暴露这个坑，是用推理而不是直接复现确认的这条结论）。表现出来的症状会是"每次请求都在创建一个新的匿名 workspace，用户的会话历史怎么都留不住"，且没有任何报错——很容易误判成别的 bug。Railway/Fly.io/Render 这类平台的默认公网域名本身就是 HTTPS，通常不会踩到；只有自己在裸 HTTP 反向代理/自签证书环境上部署时才需要特别注意。

## 部署/重启时正在跑的 run 会怎样

每次发布新版本本质上都是重启 `apps/api` 进程。M2 时期就知道的一个限制：如果重启发生在某个 run 正在执行（比如某个模型调用还没返回）的时候，驱动那个 run 的后台 `runDeliberation` promise 会跟着进程一起消失，`runs` 表里那一行会永远停在 `status = "running"`——断线重连的浏览器会一直收不到任何新事件、永远显示"进行中"。

2026-07-05 起，`apps/api/src/services/reconcile-runs.ts` 在进程启动时（迁移已跑完、开始监听请求之前）自动处理这个情况：找出所有还是 `running` 状态的 run（此时只可能是上一个进程实例留下的，因为当前进程自己还没创建过任何 run），把它们标记为 `failed`，错误信息是 `"Interrupted by a server restart before completion."`，并补一条持久化的 `run_failed` 事件，这样断线重连的客户端能拿到真实的终止状态。**这不是断点续跑**——被打断的 run 不会恢复执行，用户需要重新发起一次；真正的跨重启可恢复性目前仍然超出这个项目的规模，不打算做。

对部署本身没有额外要求（不需要什么优雅关闭钩子），单纯是进程重新起来后自愈；唯一的影响是：如果发布时机不巧撞上正有用户在跑一个耗时的 run（standard/planning 模式实测 96-301 秒），那个 run 会被打断失败，用户需要重新提交一次。

## 部署到 Railway（详细教程）

用 [Railway](https://railway.app) 作参考（GitHub 集成、Dockerfile 自动识别、一键 Postgres 插件，适合独立开发者）；Fly.io/Render 等平台的核心步骤是类似的（构建镜像 → 设置环境变量 → 连接托管 Postgres）。以下步骤已经在一个真实 Railway 账号上跑通过一次（2026-07-05）：三个服务（Postgres、`api`、`web`）部署成功，`web` 的公网域名能访问，`web → api` 的内网转发（`GET /api/conversations`）返回正确的 JSON、workspace cookie 也正确带上了 `Secure`/`HttpOnly`。过程中踩到的坑（尤其是下面「`api` 的 PORT 必须手动写死」这条）已经按实际结果改写进了下面的步骤，不是最初凭官方文档猜的版本。

### 准备工作

- 代码已推到 GitHub（`YinChingZ/MMD`），Railway 需要授权访问这个仓库。
- 提前生成一个 `ENCRYPTION_KEY`：`openssl rand -base64 32`，先存好，第 3 步要用。Railway 不会替你生成这个值。
- 一个 Railway 账号（railway.app，GitHub 登录即可）。

### 第一步：建 Project，加 3 个服务

一个 Railway Project 里放 3 个服务：Postgres 插件、`api`、`web`。这是个 monorepo（一个仓库两个 Dockerfile），所以 `api`/`web` 都是"把同一个 GitHub 仓库导入两次"，而不是两个不同仓库：

1. Railway 控制台 → "New Project" → "Deploy from GitHub repo" → 选 `YinChingZ/MMD`。这会创建出第一个服务，把它改名成 `api`。
2. 项目内 "+ New" → "Database" → "Add PostgreSQL"，加一个托管 Postgres。
3. 项目内 "+ New" → "GitHub Repo" → 同一个仓库 `YinChingZ/MMD` 再导入一次，创建第二个服务，改名成 `web`。

### 第二步：配置 `api` 服务

**Settings → Source**：Root Directory **留空不要填**——这是最容易踩的坑：Root Directory 控制的是"构建时从仓库里拉取哪些文件"，如果填成 `apps/api`，`packages/*` 根本拉不下来，`npm ci` 时 workspace 符号链接（`node_modules/@mmd/protocol -> ../packages/protocol`）就建不出来，构建会失败。Dockerfile Path 填 `apps/api/Dockerfile`。

**Variables** 标签页，加两个变量：
- `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`（Railway 的变量引用语法，直接引用 Postgres 插件生成的连接串，不用手动复制粘贴，Postgres 换密码也不用跟着改）
- `ENCRYPTION_KEY` = 准备工作里生成的那个值

**`PORT` 要手动加一个 Variable 写死（比如 `PORT` = `3000`），不要指望 Railway 自动注入的那份能被 `web` 引用到**——这是真机踩出来的坑：Railway 确实会在运行时给容器注入 `PORT`，但那份是隐式的进程环境变量，不是 Variables 面板里存着的、能被其他服务用 `${{api.PORT}}` 引用的"服务变量"。实测直接用 `${{api.PORT}}` 会解析成空，导致下一步 `web` 拼出来的内网地址变成 `http://api.railway.internal`（没有端口号，默认走 80），代理请求全部 `ECONNREFUSED`。手动在 Variables 里加一条 `PORT=3000`，它才会变成一个真正存在、可以被引用/写死的值。容器 CMD（`npm run db:migrate && npm run start`）启动时会自己跑迁移。

**Networking**：这个服务不用开 Public Networking——只被 `web` 通过内网访问。

### 第三步：配置 `web` 服务

**Settings → Source**：Dockerfile Path 填 `apps/web/Dockerfile`。

**Variables**：加一个 `API_BASE_URL`，值直接写死成 `http://api.railway.internal:3000`（端口跟第二步手动设的 `PORT` 保持一致；内网寻址格式是 `<服务名>.railway.internal`，零配置、自动 WireGuard 加密，不用开 `api` 的公网入口）。注意：`apps/web/Dockerfile` 里这个值是通过 `ARG API_BASE_URL` 声明的构建期参数——Railway 会自动把同名 Variable 当 build arg 传进去，不需要额外找什么"Build Arguments"设置；但既然是构建期烘焙进 `.next/routes-manifest.json` 的值，**改了这个 Variable 之后要确认 Deployments 页面真的触发了一次新的 build**，不是简单地热更新运行时环境变量就生效（实测：只改 Variable、没等新 build 跑完就测试，请求仍然会打到旧地址）。

**Networking**：Settings → Networking → "Generate Domain"，拿到一个 `*.railway.app` 域名，自动签发/续期 HTTPS 证书——这正好满足前面"匿名 workspace cookie 要求生产环境走 HTTPS"那条硬性要求。想用自己的域名的话，在这里加自定义域名，按提示加一条 CNAME + 一条 TXT 记录到你自己的 DNS。

### 第四步：首次部署与验证

两个服务的 Deployments 页面都能看构建日志。重点确认：
- `api` 的构建日志里能看到 `npm run db:migrate` 跑完（应该会打印 "Applied: 0001_init.sql, ..." 这类信息，7 个迁移文件全部成功）。
- `api` 的运行日志里能看到 `No ./models.config.json found — using MockProvider` 这行（除非你特意挂载了模型注册表）——纯 BYOK 模式的预期状态。
- 打开 `web` 的公网域名，走一遍"创建会话 → 提交一个 mock 模式的 run → 等到 completed → 看到结果"的完整流程，确认和本地 `npm run dev`/`docker compose` 验证过的行为一致。
- 快速验证 `web → api` 内网转发是否打通，不用打开浏览器：`curl -i https://<你的 web 域名>/api/conversations`，期望 `200` + `{"conversations":[]}` + `Set-Cookie` 里带 `Secure`/`HttpOnly`（2026-07-05 真实部署里就是靠这条命令定位到上面那个 PORT 坑的）。如果返回一个没有 JSON 内容、纯文本的 `500 Internal Server Error`，基本可以确定是 `API_BASE_URL` 指错了内网地址/端口，回去检查第三步。

### 日常运维

- **发布新版本**：默认 push 到 GitHub 对应分支会自动触发两个服务重新构建部署，不用手动操作。
- **重启会中断正在跑的 run**：见上方"部署/重启时正在跑的 run 会怎样"一节——`reconcile-runs.ts` 会在下次启动时自动把卡住的 run 标记失败，不需要额外运维动作，只是提前设好预期。
- **看日志**：每个服务的 Deployments → 具体某次部署 → Logs，或者 Railway CLI 的 `railway logs`。
- **回滚**：Deployments 页面里选中之前一次成功的部署，"Redeploy"。

## 验收状态

实现阶段先用不依赖 Docker 的本地文件拷贝模拟排查了两个最高风险的假设，随后在真正装了 Docker 的环境里补跑了一遍完整验证：

- ✅ `docker build -f apps/api/Dockerfile .` / `docker build -f apps/web/Dockerfile .` 均构建成功。
- ✅ `docker compose up --build` 三个服务全部正常启动：`postgres` 通过 healthcheck、`api` 容器启动时自动跑完 6 个迁移文件、`web` 正常渲染首页。
- ✅ 通过 `web` 容器的 rewrite 代理（`http://localhost:3001/api/...`，不是直接打 `api` 容器的端口）走完整用户流程：创建会话 → 提交一个带假 API key 且 `save:true` 的 BYOK run（验证 key 保存/加密路径）→ 直接查询容器内 Postgres 确认加密列不包含明文 key → 提交一个默认模型（mock）的 run 并等到 `completed`，`GET /result` 返回的 `final_answer`/`cost` 均正确。
- ✅ 那个用假 key 的 BYOK run 按预期收到真实 OpenAI 返回的 401（确认容器出网正常），run 被正确标记为 `failed` 并给出清晰错误信息，`api` 容器本身没有崩溃。
- ✅ 顺带确认了上面"生产环境必须用 HTTPS"一节提到的 `Secure` cookie 行为——`docker compose` 环境下 `Set-Cookie` 头确实带 `Secure`。
- 验证完毕后清理了所有测试容器/卷/镜像，不留痕迹。
