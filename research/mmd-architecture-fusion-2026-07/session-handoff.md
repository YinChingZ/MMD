# MMD 架构与研究改动 Session Handoff

日期：2026-07-20  
用途：供新的 Codex 对话直接读取现有分析，并分别规划架构、文档、WebUI 和研究方案改动。本文只提供权威路径与方向摘要，不替代各实施 session 的详细计划。

## 0. 阅读顺序与结论优先级

新的 session 应按以下顺序读取：

1. [架构融合最终报告（最新权威结论）](./report.md)
2. [架构融合批判性分析](./analysis.md)
3. [架构融合证据台账](./sources.md)
4. [架构融合反方审查](./self_review.md)
5. [多模型协商项目全面对比报告](../mmd-comparative-landscape-2026-07/report.md)
6. [竞品对比批判性分析](../mmd-comparative-landscape-2026-07/analysis.md)
7. [Paper A 当前研究方案 v0.4](../mmd-research-plan/paper-a-study-plan.md)
8. [MMD 总体研究规划报告](../mmd-research-plan/report.md)

优先级说明：`report.md` 中的 Planning `GlobalCompose` 结论是本对话最后确认的设计，覆盖较早文档中“per-topic SectionCompose + deterministic TLDR assembly”的建议。Paper A v0.4 是待修订基线，不包含本对话的最新融合决策。

## 1. MMD 两个分支的架构改动

涉及分支：`main` 与 `litellm-integration`。两个分支必须实现同一协议语义、artifact schema 和 failure semantics；正式研究只在 parity gate 通过后合并分析。

### Brief

- **Quick**：产品只保留 centralized；普通产品严格 N=2。Paper A 的 C4 是独立实验实例 `Traceable-Quick-C@N3`，只能由 experiment manifest 显式运行。
- **Standard-C**：完整保留当前 coordinator Normalize/Compose，继续作为兼容默认和 Paper A 主路径。
- **Standard-D**：新增 peer-governed 分支，从 post-revision claims 进入 peer Align、确定性聚类、Vote 和确定性权威输出；在 presentation/fidelity gate 前保持 experimental。
- **Planning**：彻底采用层级式 coordinator。Topic deliberation/Normalize 后不再产生多个用户可见 sections，而是进入一次 `GlobalCompose_C`，输出一个融合的 `PlanningFinalAnswer`。
- **跨分支契约**：统一 governance 字段、classification basis、alignment schema、candidate lineage、GlobalCompose lineage、trace v3 和 partial-failure 行为。

分析入口：

- [推荐协议与 Paper A artifact branching](./report.md#2-推荐协议)
- [产品接口与内部研究因子](./report.md#3-产品接口与内部协议因子)
- [Trace 与 failure semantics](./report.md#5-trace-与-failure-semantics)
- [两个分支当前角色与 parity 缺口](../mmd-research-plan/report.md#21-两个分支的角色)

当前实现定位入口：

- [`main` orchestrator](../../packages/orchestrator/src/index.ts)
- [协议 budget/mode](../../packages/protocol/src/budget.ts)
- [Normalize schema](../../packages/protocol/src/schemas/normalize.ts)
- [Compose/Planning schemas](../../packages/protocol/src/schemas/compose.ts)
- [API run surface](../../apps/api/src/routes/runs.ts)
- `litellm-integration` 的实现应由对应 session 在该分支/worktree 中读取并形成自己的 parity 改动计划。

## 2. 全局文档改动

### Brief

- 协议文档需要把 host orchestrator 与 LLM coordinator 分开定义。
- Mode 仍为 Quick/Standard/Planning；只有 Standard 暴露 `centralized | distributed` governance。
- 明确产品 Quick@N2 与研究 `Traceable-Quick-C@N3` 的区别。
- Standard-D 使用 `peer-governed`/`distributed epistemic governance`，不要写成“没有 orchestrator”。
- Planning 文档需改为单一 GlobalCompose 融合答案；旧 sectional Planning 只作为版本化历史协议或消融条件。
- 更新调用数、failure fallback、lineage、classification basis 和 `mmd.trace.v3`。
- 旧研究与竞品文档中关于 coordinator 瓶颈的判断应保留为历史问题，不应因新增分支而删除。

分析入口：

- [架构融合最终报告](./report.md)
- [现有协议与源码证据](./sources.md#本地实现与研究文档)
- [竞品定位、Normalize/Compose 风险与调用量](../mmd-comparative-landscape-2026-07/report.md)
- [研究基础设施与 trace 需求](../mmd-research-plan/paper-a-study-plan.md#15-研究基础设施要求)

主要现有文档入口：

- [Protocol](../../docs/protocol.md)
- [Roadmap](../../docs/roadmap.md)
- [README](../../README.md)

## 3. WebUI 改动

### Brief

- Quick 页面不显示 governance 选择；固定 centralized，并解释它是低延迟模式。
- Standard 页面增加两个清晰选项：Centralized/Classic 与 Peer-governed/Experimental；默认保持 centralized。
- Standard-D 同时展示 canonical ledger/decision 与可选 non-authoritative prose，必须能看到 candidate lineage、classification basis、partial quorum 和 disputed points。
- Planning 页面只显示一个融合的最终答案；topics、claims、votes 和 cross-topic dependencies 进入可展开 trace，而不是多个并列 final sections。
- Planning 的 `coordinator_synthesis` 与 panel consensus 必须视觉区分。
- 不支持的 mode/governance 组合应在前后端明确拒绝，不能静默回退。

分析入口：

- [产品模式矩阵与命名](./report.md#executive-summary)
- [Standard-D 权威输出与可选 polish](./report.md#23-standard-d新增-peer-governed-路径)
- [Planning GlobalCompose 与最终 schema 方向](./report.md#24-planningcoordinator-locked--global-compose)
- [产品与研究接口的批判性分析](./analysis.md#dimension产品与研究接口)

WebUI 具体组件、状态流和迁移步骤由 WebUI session 在读取当前 `apps/web` 实现后规划。

## 4. 研究计划改动

### Brief

- Paper A 的 C0–C6 主干和 H1–H3 不推翻；coordinator 架构继续作为主要研究对象。
- C4 正式命名为 `Traceable-Quick-C@N3`，与产品 Quick@N2 分开；C4/C5 必须共享 N=3 proposals 和相同 central Normalize/Compose。
- Standard governance 作为预先声明的 RQ4 secondary branch，不应在看到主结果后才触发。
- 从同一 post-revision artifact 生成 CN/DN candidate sets，并形成 CN+CR、CN+DR、DN+CR、DN+DR 四个内部 cells；这些是条件性 pipeline contrasts，不是天然可加的纯机制常数。
- 增加 false merge/split、minority distinguishability、alignment disagreement、classification basis、candidate→final lineage 和 branch-specific failure 指标。
- Planning 作为 Stage 4 的 coordinator-maximal 外部效度配置：Outline、topic Normalize、GlobalCompose 均由 coordinator 治理；不得与 Standard 的 C6 直接解释为同一个 deliberation estimand。
- main 与 LiteLLM 必须通过同一 deterministic fixture 的 phase、candidate、ballot、classification、GlobalCompose lineage、failure 和 usage parity gate。

分析入口：

- [Paper A 融合方案与 2×2 governance bridge](./report.md#4-paper-a-如何融合而不破坏原计划)
- [治理对照的因果解释边界](./analysis.md#dimension因果可识别性)
- [信息保真与新增指标](./analysis.md#dimension信息保真)
- [Paper A 当前 C0–C6、primary contrasts 和 D5/D6](../mmd-research-plan/paper-a-study-plan.md#9-实验条件)
- [Paper A manifest、trace 和 parity gate](../mmd-research-plan/paper-a-study-plan.md#15-研究基础设施要求)

## 5. 建议拆分的新 Sessions

后续不要在一个对话中同时实现全部范围。建议分别启动：

1. **Protocol/Architecture session**：读取第 1 部分引用，检查两个分支并形成实现与迁移计划。
2. **Documentation session**：读取第 2 部分引用，建立需要更新的文档清单与版本规则。
3. **WebUI session**：读取第 3 部分引用，再检查 `apps/web` 现状并规划交互。
4. **Research-plan session**：读取第 4 部分引用，把 Paper A v0.4 升级为新版本并单独处理统计、多重比较与预算。

每个 session 应自行检查当前分支状态、未提交改动、测试和 schema consumers，并在实施前产出自己的详细计划；本 handoff 不授权自动合并分支、修改预注册结论或删除旧协议版本。
