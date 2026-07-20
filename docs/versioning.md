# MMD 版本与兼容规则

*[English](versioning.en.md)*

本文定义 MMD 协议、trace、算法、实验条件和文档的版本边界。目标是让运行结果可解释、旧结果可读取，并避免把产品模式、研究条件或里程碑编号误当作协议版本。

## 1. 五条独立版本轴

| 版本轴 | 当前示例 | 表示什么 | 何时升级 |
|---|---|---|---|
| 协议语义 | `mmd.v3` | phase graph、mode/governance 组合、权威 artifact、classification 与 failure semantics | 任一协议语义发生不兼容变化时升级主版本，例如 `mmd.v4` |
| Trace schema | `mmd.trace.v3` | 可交换 trace 的核心字段、必填 lineage 和字段含义 | 修改必填核心字段、字段含义或 lineage 约束时升级；非规范诊断只能加到 `extensions` |
| 算法/renderer | `normalize.v3`、`complete-link.v1`、`consensus.v1`、`canonical.v1` | 会改变 candidate、聚类、分类或 canonical 输出的确定性实现 | 任何可能改变对应 artifact 的改动都升级该组件版本，即使协议仍是 `mmd.v3` |
| Prompt/模型身份 | prompt version/hash、model/provider revision | 模型调用的可复现配置 | prompt、模板、模型快照或 provider 路由改变时记录新值；正式研究前必须完整写入 call ledger |
| 文档/实验条件 | Paper A `v0.4`、`Traceable-Quick-C@N3` | 研究方案修订号或 manifest 条件名 | 只按各自研究流程升级，不改变协议版本 |

当前 package 的 `0.0.0` 不是协议版本。M0–M6 和历史 Planning `v0.2` 是开发里程碑，也不是 wire compatibility 标识。

## 2. `mmd.v3` 的稳定语义

- 产品 mode 保持 `quick | standard | planning`。
- Quick 只接受 centralized，普通产品严格 N=2。
- Standard 接受 centralized；distributed 是实验性、manifest-gated 的 peer-governed 配置。
- Planning 只接受 centralized，权威输出来自一次 GlobalCompose。
- host orchestrator 始终负责调度、ID、quorum、确定性计算、持久化和失败处理；LLM coordinator 只是在指定阶段使用的模型角色。
- classification ledger 是权威事实；模型生成的 prose 不能改写 ballots 或 classifications。

如果这些规则之一改变，不能通过静默修改 `mmd.v3` 的实现来完成，必须升级协议版本并提供迁移说明。

## 3. Trace 与兼容读取

- 新运行只写 `mmd.trace.v3`。
- 旧结果可以继续读取，但读取端不得推断或补造旧运行从未保存的 candidate lineage、classification basis 或 output-span lineage。
- `PlanDocument` 在 v3 中是兼容投影；`planning_final` 才是 Planning 的权威 artifact。
- 新增非协议诊断只能进入 `extensions`，消费者不得根据它定义协议语义。
- 语言无关 contract JSON 使用 `snake_case`；现有公共 HTTP API 请求仍使用 `experimentManifest`、`modelIds` 等 camelCase。两者是不同边界，不能互相推断命名规则。
- 公共 API 的纯加法字段不自动升级 `mmd.v3`；破坏现有请求/响应消费者的变化必须有独立 API 版本或明确弃用期。

## 4. 当前已实现与研究目标

文档必须区分 `implemented`、`experimental`、`research target`、`compatibility-only` 和 `historical`：

- `implemented`：在当前分支有 schema、消费者和测试支持。
- `experimental`：已实现，但只能通过 manifest 或专门入口启用，不能描述为默认产品能力。
- `research target`：研究方案要求但当前 trace/runner 尚未完整实现，例如 CN/DN 共享 branch root 的完整 2×2 运行、显式 prompt hash 和独立 classification-basis kind。
- `compatibility-only`：只供旧 UI/reader 使用，不能反馈进权威 v3 结果。
- `historical`：保留当时设计与测试记录；只添加状态说明和勘误，不把旧叙述改写成当前事实。

## 5. 双语与发布纪律

- `README.md`/`README.en.md`、`protocol.md`/`protocol.en.md`、`prior-art.md`/`prior-art.en.md` 必须在同一提交同步更新。
- contract schema、示例和文档发生变化时，必须共同通过 schema 校验和 parity fixtures。
- 任何声称“已实现”或“已验证”的文案必须能定位到当前源码、测试或带日期的历史记录。
- coordinator 瓶颈、false merge/split 和 dispute laundering 等已识别风险，即使新增 Standard-D，也不得从历史研究文档中删除。
