# MMD 与多模型协商项目的系统比较（Final v2）

研究截止：2026-07-20；本地 MMD 基线：commit `1efc4cc`（2026-07-15）。

> 快照说明：Protocol v3 后续在 `da304a3` 落地。本文关于 `1efc4cc` 当前实现的
> 描述保留为研究基线，不随代码重写；当前产品语义见 `docs/protocol.md`。文中对
> Normalize/Compose coordinator 瓶颈的判断仍有效，是 Standard-D 对照的研究动机。

## 一、结论先行

MMD 的差异不再能概括为“多个模型互评、投票、保留分歧”。2025–2026 年出现的一批 Council 项目和 MALLM 已覆盖匿名互评、Borda/多数/approval voting、异议展示、早停、成本核算、部分失败降级、可机读 verdict 与可替换协议。现有 [`docs/prior-art.md`](../../docs/prior-art.md) 只比较 Fusion、litesquad、LiteLLM，已经明显不完整。

MMD 目前最准确、也最可防守的定位是：

> 一个面向审计和决策记录的“命题级多模型审议工作台”：每个候选命题保留原始来源，由各参与模型显式表决，再用确定性规则标注支持度与严重异议，同时提供 quorum、成本熔断、持久化 trace、长文分题和产品 UI。

这是一种**独特组合**，但不是每项能力都独占。尤其需要修正两种过强说法：

1. “MMD 没有单一模型拥有裁决权”只对共识标签成立。单一 coordinator 仍控制 Normalize 阶段的候选集合，Compose 阶段也控制最终措辞；它们分别拥有议程设置权和编辑权。
2. `strong_consensus` 表示全体参与模型支持，不表示高概率正确。模型可能共享同一错误或被多数意见带偏；在没有校准实验前，共识强度不能当作事实置信度。

按用途看，没有一个项目全面优胜：MMD 在命题级审计与分歧数据上最具区分度；MALLM 在协议研究和系统消融上更强；Amiable Dev LLM Council 在 MCP/CI、匿名排名、自适应算力和工程化入口上更强；Fusion 在托管体验与搜索整合上更强；AutoGen/CrewAI 等在工具型任务执行上远强于 MMD，但不是同类协议。

## 二、先把项目分对类

“multi-agent”“multi-model”“debate”“ensemble”经常被混用。若不先分类，会把框架能力误当成现成协商机制。

| 类别 | 代表项目 | 核心问题 | 与 MMD 的关系 |
|---|---|---|---|
| 结构化多模型审议 | MMD、Amiable LLM Council、Council Engine、Karpathy LLM Council、litesquad | 多个答案如何互评、形成决策并展示分歧 | 直接竞品 |
| MAD 研究框架 | MALLM、RECONCILE、Du et al. Debate、Multi-LLM Debate | 讨论拓扑、轮数、模型多样性和决策协议何时有效 | 直接机制对照 |
| 多模型聚合 | Fusion、LLM-Blender、MoA | 多次生成后如何排名、融合或分层聚合 | 强 baseline；通常没有真正的立场修订 |
| 通用多智能体编排 | AutoGen、CAMEL、CrewAI、MetaGPT、AgentVerse | 如何分工、调用工具、执行复杂任务 | 邻近基础设施；可实现 MMD，但默认没有其共识语义 |
| 多评委/评测委员会 | ChatEval、Language Model Council | 多个模型如何共同评价输出或模型 | 专用场景，不是通用回答系统 |
| 模型路由 | LiteLLM Router、RouteLLM 类系统 | 选哪个模型来答 | 互补基础设施，不是协商 |

这个分类解释了为什么“LiteLLM 没有此能力”不能推出“MMD 没有竞品”：LiteLLM 是网关/路由层，真正对手已经在 Council 和 MAD 两个谱系中出现。

## 三、MMD 的当前实现基线

### 3.1 协议与数据

Standard 模式是 Propose→Critique→Revise→Normalize→Vote→Compose。Propose 隔离初始答案；Critique 让模型交叉评议；Revise 记录立场变化；Normalize 用 coordinator 合并为候选命题；Vote 产生 `approve`、`approve_with_conditions` 或带严重度的 objection；代码再按比例阈值给出 `strong_consensus`、`qualified_consensus`、`disputed` 或 `rejected`。

候选命题的 `source_claim_ids` 是 schema 级非空约束，能从合并后结论回看原始主张；critical objection 不会被简单多数吞掉；quorum 默认要求三分之二响应，并标记 partial。对应实现见 [`normalize.ts`](../../packages/protocol/src/schemas/normalize.ts)、[`consensus.ts`](../../packages/protocol/src/consensus.ts) 与 [`quorum.ts`](../../packages/protocol/src/quorum.ts)。

Quick 模式省略 critique/revise/vote；Planning 模式先由 coordinator 拆成最多 8 个主题，再对每个主题并行运行完整协议。后者解决长文 claim 池膨胀，但也进一步放大调用数和 coordinator 对主题边界的影响。

### 3.2 工程与产品能力

当前源码已包含 API、Web、CLI、Postgres 持久化、SSE、BYOK、分享、成本熔断、部分失败处理、用户自定义 JSON、claim/item 与 compose 流式、多图输入，以及针对 OpenAI/OpenRouter BYOK 的可选 web search。`README.md` 仍说“M6 尚未开工”，但 [`docs/roadmap.md`](../../docs/roadmap.md) 已记录 M6.1–M6.6 于 2026-07-08/09 完成；因此任何外部定位材料都应以源码和 roadmap 为准。

MMD 的工具能力仍是受限搜索开关，不是通用 agent loop：只在 propose/critique 使用受支持 provider 的内建 search，没有任意工具规划、跨步执行、共享工作空间或动态角色生成。

### 3.3 调用量与公平成本口径

在无 repair、无搜索额外往返且有 `N` 个模型时，MMD standard 的核心调用数是 `4N + 2`：propose/critique/revise/vote 各 `N` 次，normalize/compose 各 1 次。默认 `N=3` 即 14 次；quick 是 `N + 2`，默认 5 次。Planning 若拆成 `T` 个主题，大致为 `1 + T(4N + 2)`（1 次 outline；各主题完整审议和 section compose），虽然主题并行降低墙钟时间，却不降低 token/美元总量。repair retry、自定义 JSON 格式化和 web search 会继续增加实际费用。

Fusion 默认 3 panel 是 panel 3 次 + judge 1 次，再加外层正常回答，官方估计约单次 completion 的 4–5 倍；Karpathy/Amiable 类 3 模型 council 通常是 3 次初答 + 3 次互评 + 1 次 chairman，约 7 次，风格归一化或附加 verdict 会再增加。MoA 的调用量取决于层数和每层 agent 数。由于模型、上下文膨胀、推理 token、搜索费用和并行方式不同，**调用次数只能解释拓扑，不能替代真实 USD/token/latency**；没有 compute-matched 实验时不能说哪条管线“更高效”。

### 3.4 交付形态、许可与成熟度

| 项目 | 主要交付面 | 公开许可/维护信号（访问日快照） | 审慎判断 |
|---|---|---|---|
| MMD | Web、REST API、CLI、Postgres/SSE、Docker | 根仓库未见 `LICENSE`，根 package 为 private；main 在 2026-07 活跃 | 工程面较完整，但没有明确开源许可会阻碍采用与外部贡献 |
| Amiable LLM Council | Python、MCP、HTTP、CLI、CI | MIT；417 commits、测试/ADR/安全与 benchmark 目录 | Council 类中工程化最强之一；仍缺统一外部质量验证 |
| Karpathy LLM Council | 本地 Web | MIT；19k+ stars，但作者明确不维护 | 认知影响大，长期维护承诺弱 |
| MALLM | Python package、配置、demo、dataset/eval | 论文、PyPI、官方代码 | 研究成熟度强，生产运维不是主目标 |
| Council Engine | Python/CLI/REPL、SQLite | MIT；4 commits、无 release | 设计理念接近，当前不宜按成熟产品看待 |
| Star Chamber | Python SDK/CLI | Apache-2.0；v0.3.0（2026-06-24） | 窄领域、可消费 schema 明确，规模仍小 |
| litesquad | Python CLI/Web | Apache-2.0；20 commits、无 release | 可运行原型，不是成熟平台 |
| MoA / LLM-Blender | 研究代码与评测脚本 | Apache-2.0 / 各自仓库声明 | 机制和复现资产强于产品运维 |

stars、commit 数和 release 只是维护信号，不是质量指标。这里最值得立即处理的反而是 MMD 自身：若希望以开放框架推广，应该明确许可证；若不打算开源，也应避免用“开放实现”作为差异化卖点。

## 四、直接竞品对照

符号：● 原生核心能力；◐ 部分/可选；— 未见或非目标。这里比较公开默认机制，不把“可以自己编程实现”算作原生能力。

| 项目 | 核心流程 | 真正修订立场 | 决策机制 | claim 级来源 | 分歧保留 | 可靠性/成本 | 最适合 |
|---|---|---:|---|---:|---:|---|---|
| **MMD** | 提案→互评→修订→归一→逐 claim 投票→合成 | ● | 确定性比例分类 + objection severity | ● | ● | quorum、partial、成本熔断、SSE | 可审计决策、过程研究 |
| **Amiable LLM Council** | 独立回答→匿名排名→Chairman | — | Borda 排名；部分 verdict 由宿主计算 | — | ◐ 可抽取 dissent | 分层超时、部分结果、成本、早停/升级、MCP/HTTP | CI 门禁、工程 second opinion |
| **Council Engine** | 提案→受限词汇批评→lead resolution | — | lead 在 4 种结果间分类 | — | ● alternatives/question/investigate | SQLite audit；成熟度尚早 | 探索型决策、缺信息识别 |
| **Karpathy LLM Council** | 独立回答→匿名互评排名→Chairman | — | 模型排名 + Chairman 合成 | — | ◐ 可看原答案/互评 | 本地 Web；作者明确不维护 | 低门槛多模型对照 |
| **litesquad** | 异构 workers→固定 critic→修订→聚类→judge | ● | 单一 judge 合成 | — | — | mock/基础测试；无 agentic tools | 深度单次回答原型 |
| **OpenRouter Fusion** | 外层模型按需触发 panel→judge 分析→外层回答 | — | judge 识别共识/矛盾，外层模型写答案 | — | ● 结构化矛盾/盲点 | 托管、搜索、递归保护；约 4–5× | 开放式研究与低摩擦产品调用 |
| **MALLM** | 可组合 persona/response/topology/decision | ◐ 依范式 | 多数/一致/简单/approval vote、judge | — | ◐ 完整 debate data | 内置 dataset/eval；非生产重点 | MAD 实验与协议消融 |
| **RECONCILE** | 异构模型多轮互看→修订答案/置信度→加权票 | ● | 置信度加权投票 | — | — 目标是收敛 | 有论文实验；非通用产品 | 异构模型推理研究 |
| **Star Chamber** | 多 provider 代码审查→发现聚类→分桶 | — | consensus/majority/individual | ◐ 文件/行/类别 | ● 保留 individual | SDK/CLI、schema、发布包 | 代码审查和设计问题 |
| **rachittshah/llmcouncil** | vote/debate/synthesize/critique/red-team/MAV 可选 | ◐ | 依协议：排名、Chairman 或 verifier | — | ◐ dissent scores | 成本预估、可选 KS 早停、MCP | 多协议实验型工具 |

来源：[Amiable Dev](https://github.com/amiable-dev/llm-council)、[Council Engine](https://github.com/amithmathew/council-engine)、[Karpathy Council](https://github.com/karpathy/llm-council)、[litesquad](https://github.com/EricThomson/litesquad)、[Fusion](https://openrouter.ai/docs/guides/routing/routers/fusion-router)、[MALLM](https://arxiv.org/abs/2509.11656)、[RECONCILE](https://aclanthology.org/2024.acl-long.381/)、[Star Chamber](https://github.com/peteski22/star-chamber)、[llmcouncil](https://github.com/rachittshah/llmcouncil)。

### 4.1 对 Amiable Dev LLM Council

这是现阶段最值得正面对比的产品型开源对手。它与 MMD 都强调独立回答、交叉评议、流式、成本和部分失败；但设计中心不同：

- Amiable 评的是“整份回答谁更好”，匿名随机标签、可选风格归一化、自投排除和 Borda 排名专门对付身份/风格/自偏好；MMD 评的是“每个规范化命题得到多少支持、有什么严重反对”。
- Amiable 的 chairman 仍决定最终 prose；MMD 的 composer 也决定 prose，但不能改写代码已经算出的共识标签。
- Amiable 已有 MCP、Python、HTTP、CLI、CI verdict、分层模型池、性能选择、reviewer sampling、早停与弱共识升级；这些是 MMD 当前明显短板。其 20 项 golden set 适合防回归，但规模不足以证明普遍质量优势。[官方 README](https://github.com/amiable-dev/llm-council)
- MMD 的优势是 claim lineage、revision、objection severity、planning 分题和面向人查看全过程的 Web 工作台；Amiable 的优势是工程入口与自适应算力。

结论：MMD 不应复制 Borda 作为唯一机制，但应借鉴匿名化/自投排除作为 bias-control baseline，并优先补 MCP/机器消费接口与 adaptive depth。

### 4.2 对 MALLM

MALLM 是现有 prior-art 最大的学术遗漏。它把“谁参与、如何发言、谁看谁、如何决策”拆成可换模块，支持 Memory/Relay/Report/Debate 拓扑和多数、一致、简单投票、approval voting 等协议，附 Hugging Face 数据集加载和评测管线；论文称无需额外编程即可组合 144 种设置。[MALLM 论文](https://arxiv.org/abs/2509.11656)、[官方 demo](https://mallm.gipplab.org/)

MMD 的协议更具体、schema/trace 更强、产品更完整，但实验自由度显著较低：固定六阶段把 agent behavior、communication topology 与 decision protocol 绑在一起，很难回答“到底是 critique、revision、显式 vote 还是更多 compute 带来收益”。如果 MMD 要走论文路线，MALLM 不是普通竞品，而是实验平台基准。

### 4.3 对 Council Engine 与 Star Chamber

Council Engine 与 MMD 在理念上非常接近：都反对把表面流畅当成已解决，都要求显式 critique 和可见分歧。Council Engine 的四种 resolution——recommendation、alternatives、question、investigate——比 MMD 强制生成一个 final answer 更善于表达“现在还不能下结论”；但分类由 lead model 完成，且项目截至访问日只有 4 次提交，工程证据很薄。[官方仓库](https://github.com/amithmathew/council-engine)

Star Chamber 是窄领域但很重要的反例：它已经把多 provider 发现按文件、行位置与类别聚类，再确定性分成 consensus/majority/individual。它没有 MMD 的多轮协商，却证明“确定性共识分桶 + 结构化来源”并非 MMD 独占。MMD 的优势是通用 claim 与 objection；Star Chamber 的优势是领域 schema 可直接行动。[官方仓库](https://github.com/peteski22/star-chamber)

### 4.4 对 RECONCILE 与经典 MAD

RECONCILE 比 litesquad 更接近真正的异构多模型协商：每个模型给出答案、解释与置信度，随后多轮互看、修订，收敛后进行置信度加权投票；论文在七个推理类 benchmark 上比较了同模型 debate、judge 和 self-consistency。[ACL 2024](https://aclanthology.org/2024.acl-long.381/)

MMD 更擅长开放式多命题答案和异议审计，RECONCILE 更适合能提取单一答案的闭集推理。MMD 没有校准 confidence；RECONCILE 没有 claim lineage。两者共同风险是从众：NeurIPS 2024 的 Multi-LLM Debate 实验发现模型会随多数意见改变答案，说明“发生修订”本身既可能纠错，也可能传播错误。[论文](https://proceedings.neurips.cc/paper_files/paper/2024/file/32e07a110c6c6acf1afbf2bf82b614ad-Paper-Conference.pdf)

## 五、强基线：不协商也可能更好

LLM-Blender 用 PairRanker 排候选，再由 GenFuser 融合；MoA 让每层多个模型看到上一层输出，再由 aggregator 生成下一层/最终答案。它们没有 MMD 的显式 critique→revise→vote，但都有公开评测与可运行代码。[LLM-Blender](https://github.com/yuchenlin/LLM-Blender)、[MoA](https://github.com/togethercomputer/MoA)

这类项目对 MMD 的挑战不是产品功能，而是因果解释：如果相同模型、相同 token/美元预算下，简单多采样 + ranking/fusion 已达到相同质量，六阶段交互就没有“提高平均分”的独立证据。MMD 仍可能靠审计和分歧校准产生价值，但必须把这一目标单独评测，不能用更多调用后的高分来证明协议有效。

OpenRouter 2026 年的 Fusion 进一步强化这一点：官方管线的 panel 不互相辩论，judge 只做 structured comparison，外层模型再写最终答案；默认 3 panel 约为单次 4–5 倍成本。它的产品强项是按需触发和 panel/judge 原生搜索，弱项是闭源内部细节与缺少 claim-level provenance。[官方文档](https://openrouter.ai/docs/guides/routing/routers/fusion-router)

## 六、为什么 AutoGen/CrewAI 不是直接竞品

AutoGen、CAMEL、CrewAI、MetaGPT 和 AgentVerse 都能编排多个角色，甚至能搭建 debate；但它们提供的是“积木”，不是 MMD 这种协议产品：

- AutoGen 提供 round-robin、模型选择下一发言者、Magentic-One 与 handoff/swarm，并可组合 termination conditions；没有默认的 claim normalization、逐 claim ballot 或比例标签。[AutoGen Teams](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html)
- CAMEL 重点是角色扮演社会与可选 critic；CrewAI 重点是 agents、tasks、sequential/hierarchical processes、flows、tools、memory、guardrails 和部署；MetaGPT 把产品经理/架构师/工程师按 SOP 串成软件公司；AgentVerse 分任务协作和社会模拟。[CAMEL](https://docs.camel-ai.org/key_modules/societies)、[CrewAI](https://docs.crewai.com/)、[MetaGPT](https://github.com/FoundationAgents/MetaGPT)、[AgentVerse](https://github.com/OpenBMB/AgentVerse)

它们在开放式任务执行上比 MMD 强：能调用任意工具、持有状态、动态转交工作、产生外部副作用。MMD 在判断结构上更强：每个阶段 schema 固定、共识语义明确、trace 面向审计。合理关系是“MMD 协议可作为这些框架里的一个 team pattern”，不是相互替代。

## 七、现有文档漏掉了什么

### 必须加入主对照表

1. **Amiable Dev LLM Council**：它已经实质覆盖匿名互评、Borda、dissent、机器 verdict、失败降级、成本和 adaptive compute；不加入会高估 MMD 的工程独特性。
2. **MALLM**：当前公开资料中最系统的 MAD 协议实验框架之一，直接挑战 MMD 的研究平台定位。
3. **RECONCILE**：异构多模型、多轮修订、置信度加权投票，直接挑战“其他项目没有真正协商”的表述。
4. **Karpathy LLM Council**：机制不新，但知名度和 fork 生态使其成为用户认知中的默认参照。
5. **Council Engine**：明确以“不强迫虚假共识”和 investigation/question 输出为核心，与 MMD 的产品哲学直接重叠。
6. **Star Chamber**：在代码审查场景已经实现结构化来源与确定性 consensus/majority/individual 分桶。

### 应作为机制 baseline，而非“竞品”

7. **LLM-Blender、MoA**：控制“多模型 + ranking/fusion”效应。
8. **Du et al. Debate、Multi-LLM Debate**：控制多轮互动并暴露从众风险。
9. **ChatEval/Language Model Council**：说明多模型评委和通用回答系统的差别。

### 应放在“邻近生态”

10. **AutoGen、CAMEL、CrewAI、MetaGPT、AgentVerse**：解释 MMD 是 opinion/claim deliberation protocol，不是通用 multi-agent runtime。

原文中“LiteLLM 生态里这一整层能力目前不存在”的结论应改成更窄的句子：**LiteLLM core 本身主要是网关、路由与可靠性层，未原生提供完整审议协议；但其上层完全可以承载已有的 Council/MAD 项目，生态位并非无人占据。**

## 八、MMD 的真正优势与短板

### 8.1 仍有区分度的优势

- **命题级而非回答级**：把长回答拆为 claims 后逐项归一、表决和分类，避免“一份回答总体最好”掩盖局部错误。
- **来源 lineage 是数据约束**：`source_claim_ids` 非空是 schema 规则，不只是保存聊天 transcript。
- **异议有严重度和保护规则**：critical objection 强制进入 disputed；比 Borda 排名更适合风险审查。
- **协议 trace 与产品 UI 合一**：候选、投票、position changes、partial、成本和运行进度都进入持久化结果。
- **长文 Planning Mode**：按主题并行复用审议，产品层面少见。
- **真实故障意识**：quorum、retry、流式修复、成本熔断、重启 reconcile 与 BYOK key 处理比多数论文原型成熟。

### 8.2 最需要正视的短板

- **Normalize 是信息瓶颈**：单一 coordinator 可以漏掉少数但正确的 claim；lineage 只能审计已保留内容。
- **Compose 仍可能软性改判**：标签是确定的，用户最终读到的措辞不是。缺少程序化检查确保 disputed/rejected 不被淡化。
- **无匿名化与自投偏差控制**：若 critique/vote 暴露模型身份或原作者，可能出现 provider preference、自偏好和位置偏差；Amiable 在这方面更系统。
- **协议不可插拔**：无法低成本切换 majority/approval/Borda/judge、memory/relay/report 等配置，研究能力弱于 MALLM。
- **无自适应深度**：简单问题也可能运行高成本 standard；Amiable 已有 single→mini→full escalation 和 early consensus。
- **共识未校准**：没有数据证明 label 能预测正确率、风险或人工升级价值。
- **工具边界窄**：web search 不是完整工具型 agent；对软件工程、数据处理、浏览器任务不应和 AutoGen/CrewAI 比“解决率”。
- **公开 benchmark 缺失**：有 HLE adapter，但没有统一真实模型组合、重复运行、compute-matched baseline 与可公开复现结果。
- **许可不明确**：仓库未见根 `LICENSE`；对外部用户而言，“代码可见”不等于“获得使用、修改和再分发授权”。
- **文档状态漂移**：README 和 prior-art 已落后于实现及市场，容易导致外部比较失真。

## 九、建议的定位与路线

### 9.1 对外定位

建议用：

> MMD is an audit-first, claim-level multi-model deliberation workbench. It preserves claim lineage, records revisions and objections, and computes support labels deterministically instead of asking one judge to declare consensus.

避免用：“第一个多模型协商系统”“没有任何单模型裁决权”“共识标签等于可信度”“LiteLLM 生态没有竞品”。

### 9.2 优先级建议

1. **先修文档与许可基线**：更新 README 的 M6 状态，把 prior-art 重写为“直接竞品/机制 baseline/邻近框架”三层，并明确项目许可证或非开源边界。
2. **补 normalize recall 审计**：计算每个原始 claim 是否进入 candidate、少数 claim 保留率、重复/错误合并率；允许模型对候选集做一次“遗漏申诉”。
3. **补 compose fidelity checker**：程序化检查 final prose 是否覆盖 strong/qualified/disputed，是否把 disputed 写成已解决。
4. **匿名化 critique/vote**：随机化模型标签、隐藏 provider identity、禁止自评或至少单独报告自评影响。
5. **协议模块化**：把 topology、decision rule、stopping policy 拆开，至少加入 vote-only、Borda/approval 和 judge-synthesis baselines，向 MALLM 的可消融性靠拢。
6. **自适应审议**：先 quick/single，只有在不确定、模型分歧或高风险时升级 standard；加入早停与 shadow logging。
7. **校准而不是营销 consensus**：用闭集真值和人评开放任务估计各标签的 empirical correctness/risk；UI 将“支持度”与“可信度”严格分开。
8. **统一 benchmark**：同模型、同题、同预算比较 single、same-model multi-sample、majority、LLM-Blender/MoA-style fusion、Amiable-style anonymous ranking、MMD quick/standard；报告 USD、token、延迟、partial 和重复生成方差。
9. **增加 MCP/SDK 面**：让 MMD 成为 AutoGen/CrewAI/Codex 等上层系统可调用的“审议工具”，而非只做独立 Web 应用。

## 十、最终判断

如果目标是做“多个模型给一个更好的答案”，MMD 面临的替代品很多，六阶段成本也难证明必要；Fusion、MoA、Karpathy/Amiable Council 都更短，MALLM 也更易实验。

如果目标是做“让用户知道每条结论从哪里来、谁支持、谁以什么严重度反对、哪些模型后来改变了立场，并在失败与预算约束下保留完整记录”，MMD 仍然有清晰差异。它的护城河不是民主隐喻，而是**命题级审计数据模型 + 确定性支持标签 + 面向真实运行的产品化可靠性**。

反过来说，这个定位也给出了严格的成败标准：MMD 必须证明 lineage 完整、normalize 不压掉关键少数意见、compose 不淡化争议，而且 disagreement/objection 能预测错误或升级价值。若这些不能成立，六阶段协议只是比简单 ensemble 更昂贵的解释层；若能成立，即使平均 benchmark 分数只与简单融合持平，MMD 也有独立的决策治理价值。

完整证据元数据与无法验证项见 [`sources.md`](sources.md)，分析底稿见 [`analysis.md`](analysis.md)。
