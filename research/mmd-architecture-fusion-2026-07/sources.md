# Sources：MMD 集中式与分布式协调架构融合

Access date：2026-07-20

本表 L2–L6 记录的是方案形成时的 pre-v3 baseline，现固定到 commit
`1efc4cc`，不再把后来变化的 workspace 文件误作同一证据。v3 实现落在
`da304a3`；当前实现事实应改查源码、contract 与 `docs/protocol.md`。

## 本地实现与研究文档

| ID | Claim/fact supported | Source | Publication/update date | Locator | Reliability notes | Cross-check status |
|---|---|---|---|---|---|---|
| L1 | Paper A 当前将 coordinator effect、C4–C6、candidate recall 和 trace v2 写入研究设计；尚未预注册；D10 固定主实验 N=3 | `paper-a-study-plan.md` v0.4 | 2026-07-16 | `research/mmd-research-plan/paper-a-study-plan.md:1-6, 419-461, 952-968` | 研究方案一手来源 | 与代码的当前阶段路径交叉核对；暴露产品 Quick N=2 与研究 C4 N=3 的命名冲突 |
| L2 | Quick 设计为 2 模型，运行 propose→normalize→compose；Planning 使用单 outline coordinator、每主题完整审议和 section compose | `docs/protocol.md` at `1efc4cc` | 2026-07-15 baseline | `git show 1efc4cc:docs/protocol.md`，原 55–88 行附近 | 项目当时的协议一手来源；不是 v3 当前语义 | 与当时 budget/orchestrator 交叉核对 |
| L3 | Standard/Quick 的 normalize 与 compose 都是单 coordinator 调用；Planning 的 outline、per-topic normalize、section compose 也使用同一 coordinator | Orchestrator at `1efc4cc` | 2026-07-15 baseline | `git show 1efc4cc:packages/orchestrator/src/index.ts`，原 946–1065、1316–1593 行附近 | 当时可执行实现一手来源；v3 已改为 GlobalCompose | 已与当时 prompts、protocol 交叉核对 |
| L4 | Quick budget 声明 2 模型，但 API 在未指定 model IDs 时使用 registry 中所有模型 | Budget/API at `1efc4cc` | 2026-07-15 baseline | `git show 1efc4cc:packages/protocol/src/budget.ts`; `git show 1efc4cc:apps/api/src/routes/runs.ts` | 当时的可执行实现一手来源；`da304a3` 已增加 Quick N=2 enforcement | 作为被 v3 修复的历史 gap 保留 |
| L5 | Normalize prompt 要求语义分组、保留所有 claims 和 lineage；Compose/section-compose 自称 editor not judge，但仍生成最终文字 | Prompts at `1efc4cc` | 2026-07-15 baseline | `git show 1efc4cc:packages/prompts/src/{normalize,compose,section-compose}.ts` | Prompt 一手来源；约束不能证明模型必然遵守；section-compose 后来删除 | schema 只保证字段形状，不能保证语义忠实 |
| L6 | Planning 的 executive summary 由代码拼接 section TLDR，不再有跨主题模型合成；任一 section-compose 失败仍会因 `Promise.all` 使最终构造失败 | Orchestrator at `1efc4cc` | 2026-07-15 baseline | `git show 1efc4cc:packages/orchestrator/src/index.ts`，原 1533–1593 行附近 | 当时可执行实现一手来源；`da304a3` 已替换为 GlobalCompose/fallback | 作为替换旧 Planning 的决策动机保留 |
| L7 | 既有竞争分析将单一 normalize 识别为议程设置瓶颈，将 compose 识别为编辑权瓶颈 | MMD comparative landscape report | 2026-07 | `research/mmd-comparative-landscape-2026-07/report.md` | 内部综合分析，依赖其中列出的一手来源 | 与当前代码交叉核对 |

## 外部研究

| ID | Claim/fact supported | Source | Publisher/author | Publication date | Data period | URL | Reliability notes | Cross-check status |
|---|---|---|---|---|---|---|---|---|
| E1 | 集中式候选排序与生成式融合是成熟的多模型集成范式 | *LLM-Blender: Ensembling Large Language Models with Pairwise Ranking and Generative Fusion* | Jiang, Ren, Lin; ACL | 2023-07 | MixInstruct 等论文实验 | https://aclanthology.org/2023.acl-long.792/ | 同行评审一手论文；专用 PairRanker/GenFuser，不等同于通用 LLM coordinator | 与 MoA 的集中/分层聚合方向一致 |
| E2 | 分层聚合器读取前一层多个模型输出并生成新答案，可获得强性能，但会增加聚合层计算 | *Mixture-of-Agents Enhances Large Language Model Capabilities* | Wang et al. | 2024-06-07 | AlpacaEval 2.0、MT-Bench、FLASK | https://arxiv.org/abs/2406.04692 | 一手论文；arXiv 版本，开放式评测与 MMD R/K 主任务不同 | 与 LLM-Blender 共同支持 generative aggregation 的主流性 |
| E3 | lead Orchestrator 负责规划、分派、跟踪和恢复，是复杂开放式 agent 系统的可行主流设计 | *Magentic-One* technical report | Microsoft Research, Fourney et al. | 2024-11 | GAIA、AssistantBench、WebArena | https://www.microsoft.com/en-us/research/publication/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/ | 官方一手技术报告；研究的是工具型长时任务，不是纯答案审议 | 只支持 Planning 类任务需要集中协调的合理性，不证明其最优 |
| E4 | 不要求最终共识、使用完整轨迹评分和 anti-conformity 的 MAD 可在其八个 benchmark 上改善性能并降低轮次成本 | *Free-MAD: Consensus-Free Multi-Agent Debate* | Cui et al.; Findings ACL 2026 | 2026-07 | 8 个论文 benchmark | https://aclanthology.org/2026.findings-acl.1600/ | 同行评审一手论文；其 trajectory scorer 不是 MMD 的 claim alignment | 支持保留非集中式备选，不支持直接替换 MMD coordinator |
| E5 | 多数投票可解释大量 MAD 增益，简单 ensemble 是强基线 | *Debate or Vote: Which Yields Better Decisions in Multi-Agent LLMs?* | Choi, Zhu, Li; NeurIPS 2025 | 2025 | 7 个 NLP benchmark | https://proceedings.neurips.cc/paper_files/paper/2025/file/934252acd87f254d5d4672fbde283bd2-Paper-Conference.pdf | 同行评审一手论文 | 支持 Paper A 保持 vote-only 与 deliberation 分解 |
| E6 | 决策协议的效果随 reasoning/knowledge 任务而变；增加讨论轮次可能降低投票前性能 | *Voting or Consensus? Decision-Making in Multi-Agent Debate* | Kaesberg et al.; Findings ACL 2025 | 2025-07 | reasoning/knowledge benchmarks | https://aclanthology.org/2025.findings-acl.606/ | 同行评审一手论文；主要使用同模型 agents | 支持按模式/任务选择治理，而非全局单一答案 |
| E7 | communication topology 本身是可操纵的性能与成本变量 | *Exchange-of-Thought* | Yin et al. | 2023-12-04 | 复杂推理任务 | https://arxiv.org/abs/2312.01823 | 一手预印本；比较 Memory、Report、Relay、Debate | 与 MacNet、topology propagation 研究交叉支持 |
| E8 | DAG/小世界型多智能体网络可以扩展到大量 agents，说明单中心不是唯一可扩展拓扑 | *Scaling Large-Language-Model-based Multi-Agent Collaboration* | Qian et al. | 2024-06-11 | 多种网络拓扑的论文实验 | https://arxiv.org/abs/2406.07155 | 一手预印本；超大 agent 数与 MMD N=3 相距较远 | 支持把拓扑当研究变量，不支持 MMD 上具体效应量 |
| E9 | 中等稀疏拓扑在其研究中平衡了正确信息传播与错误扩散 | *Understanding the Information Propagation Effects of Communication Topologies in LLM-based MAS* | Shen et al. | 2025-05-29 | 论文所测 MAS/datasets | https://arxiv.org/abs/2505.23352 | 一手预印本；具体方法和 MMD 不同 | 反驳“越集中或越全连接必然越好”的简单结论 |
| E10 | 在多机器人规划实验中，集中与分布式的混合架构优于两端并更好扩展 | *Scalable Multi-Robot Collaboration with LLMs: Centralized or Decentralized Systems?* | Chen et al. | 2023-09-27 | 2D/3D 多机器人任务 | https://arxiv.org/abs/2309.15943 | 一手预印本；任务域差异很大，只能作拓扑先例 | 支持研究 hybrid，但不能直接外推到文本审议 |

## Missing Or Unverified Data

- MMD 集中式和分布式 Standard 的质量差、false-merge/false-split、成本与延迟：尚无实现后的同题 paired 数据。
- Quick 中 registry 模型数超过 2 时的真实线上发生频率：代码允许，但当前部署配置和流量数据未检查。
- 分布式 alignment 的最佳 pairwise 阈值、quorum 和 tie rule：数据缺失，必须由独立 pilot/screening 冻结。
- Planning 是否因同一 coordinator 贯穿 outline/normalize/compose 而获得更好文档一致性，或放大同一偏差：没有 MMD 自身消融数据。
- 外部论文没有一个与 MMD 的 claim schema、显式 objection 严重度、三模式任务划分完全同构，因此不能借用其效应量进行功效或成本估算。
