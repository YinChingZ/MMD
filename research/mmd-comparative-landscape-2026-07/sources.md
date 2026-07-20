# Sources：MMD 多模型协商项目比较

访问日期：2026-07-20。外部项目优先采用官方仓库、官方文档或原始论文；GitHub 数值仅为访问日快照。

| ID | 支持的事实 | 来源与日期 | 可靠性与限制 |
|---|---|---|---|
| M1 | MMD 当前为 Propose→Critique→Revise→Normalize→Vote→Compose；有 claim lineage、比例共识、critical/major objection、quorum、三种模式 | 本地 `README.md`、`docs/protocol.md`、`packages/protocol`、`packages/orchestrator`；当前提交 2026-07-15 | 项目一手实现；源码优先于说明文档 |
| M2 | M6.1–M6.6 已实现：自定义 JSON、细粒度/文本流、多模态、可选 web search；README 仍称 M6 未开始 | 本地 `docs/roadmap.md`、源码与 git history，2026-07-08 至 2026-07-15 | 一手实现；揭示 README/prior-art 状态滞后 |
| M3 | 根仓库未见 `LICENSE`，根 `package.json` 标记 private | 本地文件盘点，访问 2026-07-20 | 可验证的仓库状态；不能据此推断作者未来许可意图 |
| F1 | Fusion 是外层模型→1–8 panel→judge structured analysis→外层最终回答；panel/judge 可搜索；默认约 4–5×成本 | [OpenRouter Fusion Router](https://openrouter.ai/docs/guides/routing/routers/fusion-router)，living docs，访问 2026-07-20 | 官方产品文档；内部 prompts 与逐条 lineage 未公开 |
| L1 | litesquad 是异构 worker→固定 Grok critic→worker revise→GPT-5 clustering→Opus judge；无 agentic tools | [EricThomson/litesquad](https://github.com/EricThomson/litesquad)，访问 2026-07-20 | 官方仓库；早期原型、模型角色硬绑定 |
| K1 | Karpathy LLM Council 是独立回答→匿名互评排名→Chairman 合成；作者明确不维护 | [karpathy/llm-council](https://github.com/karpathy/llm-council)，访问 2026-07-20 | 官方仓库；高知名度但明确是一次性实验 |
| A1 | Amiable Dev LLM Council 有匿名随机化互评、Borda 聚合、可选风格归一化、自投排除、dissent、结构化 verdict、成本与 SSE | [amiable-dev/llm-council](https://github.com/amiable-dev/llm-council)，访问 2026-07-20 | 官方仓库，417 commits 快照；功能声明需与实测区分 |
| A2 | Amiable Dev 支持早停、分层升级、O(N×k) reviewer sampling、分层超时与部分结果；有 20 项 golden benchmark | 同上；README 的 Compute-Optimal、Reliability、Quality Benchmark 段落，访问 2026-07-20 | 一手文档；20 项数据集只能防漂移，不能证明跨任务优越性 |
| C1 | Council Engine 是 proposal→constrained critique→lead resolution，保留 recommendation/alternatives/question/investigate 四类结果和 SQLite 审计轨迹 | [amithmathew/council-engine](https://github.com/amithmathew/council-engine)，访问 2026-07-20 | 官方仓库；仅 4 commits/0 stars 快照，成熟度低 |
| S1 | Star Chamber 对多 provider 的代码问题按位置/类别聚类并分 consensus/majority/individual | [peteski22/star-chamber](https://github.com/peteski22/star-chamber)，v0.3.0 2026-06-24；访问 2026-07-20 | 官方仓库；领域聚焦代码审查/设计问题，不是通用审议 |
| R1 | rachittshah/llmcouncil 提供 vote/debate/synthesize/critique/red-team/MAV 六类协议与可选 KS 早停 | [rachittshah/llmcouncil](https://github.com/rachittshah/llmcouncil)，访问 2026-07-20 | 官方仓库；README 中“最多 94.5%”等是转述研究，不视为该项目独立验证 |
| MA1 | MALLM 分离 persona、response generator、discussion paradigm、decision protocol，提供 144 种配置与集成评测 | [MALLM 论文](https://arxiv.org/abs/2509.11656)，2025-09-15；[交互演示](https://mallm.gipplab.org/) | 原始论文/官方项目；研究平台强，生产可靠性和产品面不是重点 |
| RC1 | RECONCILE 让异构模型多轮修订回答与置信度，收敛后做置信度加权投票；在七类基准上评估 | [RECONCILE, ACL 2024](https://aclanthology.org/2024.acl-long.381/)，2024-08 | 同行评审；部分实验仅 100 样本，模型代际较旧 |
| MB1 | Multi-LLM Debate 研究显示从众/多数暴政风险，提出控制通信与亲和性等干预 | [Multi-LLM Debate, NeurIPS 2024](https://proceedings.neurips.cc/paper_files/paper/2024/file/32e07a110c6c6acf1afbf2bf82b614ad-Paper-Conference.pdf)，2024-12 | 同行评审；任务和模型集合有限 |
| B1 | LLM-Blender 是 PairRanker + GenFuser 的选择/融合框架 | [yuchenlin/LLM-Blender](https://github.com/yuchenlin/LLM-Blender)；[ACL 2023 paper](https://aclanthology.org/2023.acl-long.792/)，2023-07 | 同行评审/官方代码；不是交互式协商，但属于必须控制的强聚合基线 |
| MO1 | MoA 是多层并行 reference agents→aggregator；官方实现含 AlpacaEval/MT-Bench/FLASK 脚本 | [Together MoA](https://github.com/togethercomputer/MoA)；[论文](https://arxiv.org/abs/2406.04692)，2024-06 | 官方代码/论文；开放式 judge benchmark 有长度、风格与模型时代偏差 |
| D1 | 多实例 debate 可提高部分推理/事实任务，但成本使原论文只用 3 agents/2 rounds | [Du et al. 项目](https://composable-models.github.io/llm_debate/)；[ICML 2024](https://proceedings.mlr.press/v235/du24e.html) | 同行评审早期工作；不等于异构多模型优势 |
| CH1 | ChatEval 用多 agent debate 组成评审团队，目标是评估其他输出而非生成用户最终答案 | [ChatEval, ICLR 2024](https://openreview.net/forum?id=FQepisCUWu)；[代码](https://github.com/thunlp/ChatEval) | 同行评审/官方代码；属于多评委而非通用决策助手 |
| G1 | AutoGen 支持 RoundRobin、SelectorGroupChat、Magentic-One、Swarm 与终止条件 | [AutoGen Teams](https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html)，living docs | 官方文档；通用编排能力不等于内置共识协议 |
| G2 | CAMEL 以角色扮演和可选 critic 为主；CrewAI 以 agent/task/process/flow、工具、记忆和部署为主；MetaGPT 以软件公司 SOP 为主 | [CAMEL Societies](https://docs.camel-ai.org/key_modules/societies)、[CrewAI docs](https://docs.crewai.com/)、[MetaGPT](https://github.com/FoundationAgents/MetaGPT)，访问 2026-07-20 | 官方资料；邻近框架，不是直接竞品 |
| G3 | AgentVerse 有任务协作与社会模拟两条主线 | [OpenBMB/AgentVerse](https://github.com/OpenBMB/AgentVerse)，访问 2026-07-20 | 官方仓库；更偏动态团队/仿真而非 claim 共识 |

## 缺失或无法验证
- MMD、Amiable Dev、Council Engine、Star Chamber、Karpathy Council 在同一模型、同一题集、同一 token/美元预算下的横向结果：没有公开的统一实验，无法判断总体质量胜负。
- MMD 的 `strong_consensus`、`qualified_consensus` 与真实正确率之间的校准曲线：尚无公开数据；这些标签目前表达协议内支持度，不是概率意义上的可信度。
- 闭源 Fusion 的完整 prompts、逐 panel 原始 trace、每题实际费用/失败分布：无法从公开资料完整验证。
- 多数新 Council 项目的安全、失败恢复和成本功能只按文档审查，本研究没有逐一购买 API 额度做端到端复跑。
- GitHub stars、commits 和 releases 是 2026-07-20 的时点快照，不应当被解释为质量排序。
