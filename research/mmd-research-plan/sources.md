# Sources

Access date: 2026-07-14

| ID | Claim/fact supported | Source | Publisher/author | Publication date | Data period | URL/locator | Reliability notes | Cross-check status |
|---|---|---|---|---|---|---|---|---|
| L1 | main 分支实现六阶段协议、planning/quick、quorum、成本与事件 trace；README 的 M6 状态存在滞后 | MMD README、protocol、roadmap、源码/测试 | YinChingZ/MMD | commits through 2026-07 | current local main | `README.md`, `docs/protocol.md`, `docs/roadmap.md`, `packages/orchestrator` | 项目一手证据；实现优先于 README 状态文案 | 源码/测试/提交记录交叉核对 |
| L2 | `standard` 默认 3 模型约 14 次核心模型调用；HLE formatter 使每题约 15 次 | HLE Adapter README + orchestrator tests | YinChingZ/MMD | 2026-07 | current local main | `benchmarks/hle/README.md`, `packages/orchestrator/test/orchestrator.test.ts` | 一手代码和文档；不代表所有失败/repair 情况 | 已交叉核对调用组成 |
| L3 | LiteLLM 分支是 Python custom provider/strategy engine，支持 policy、usage/trace、streaming 契约和 1–8 panel，但仍无完整内层工具执行循环 | architecture/development + Python implementation/tests | YinChingZ/MMD | through 2026-07-14 | local `litellm-integration` | `git show litellm-integration:docs/architecture.md` and branch files | 一手分支证据；未在本研究中用真实 API 复跑 | 由提交 diff 与架构文档交叉核对 |
| O1 | Fusion 是 panel→judge structured analysis→outer answer；panel/judge 可搜索；1–8 panel；默认 3 panel 成本约单次 4–5 倍 | Fusion Router docs | OpenRouter | living docs | accessed 2026-07-14 | https://openrouter.ai/docs/guides/routing/routers/fusion-router | 官方产品文档；内部 prompts/实现不可见 | 与官方博客交叉核对 |
| O2 | OpenRouter 在 100 个 DRACO 任务上报告 frontier panel 69.0%、budget panel 64.7%；同模型自融合从 58.8% 到 65.5%；披露 Fable 7 个任务缺失、judge 替换和污染处理 | Surpassing Frontier Performance with Fusion | Brian Thomas/OpenRouter | 2026-06-12, FAQ 2026-06-14 | DRACO 100 tasks | https://openrouter.ai/blog/announcements/fusion-beats-frontier/ | 官方自评/营销材料，不是独立同行评审；有重要方法披露但无完整原始运行资产可验证 | 与 DRACO 论文和 Fusion docs 交叉核对 |
| O3 | DRACO 有 100 个跨 10 域开放研究任务、平均 39.3 条 rubric；评分高度依赖 judge，文本/英语/静态集合有边界 | DRACO | Perplexity AI authors | 2026-02 | queries sampled Sep–Oct 2025 | https://arxiv.org/abs/2602.11685 | 基准一手论文；出自被评系统开发方，仍需外部验证 | 与 OpenRouter 对其限制的复述一致 |
| P1 | 多实例、多轮 debate 可改善数学、策略推理与事实性 | Improving Factuality and Reasoning through Multiagent Debate | Du et al., ICML/PMLR | 2024-07 | contemporaneous benchmarks/models | https://proceedings.mlr.press/v235/du24e.html | 同行评审早期核心工作；模型时代较旧，部分结果不适合直接外推 | 后续 P2/P3 对机制提出反证/限定 |
| P2 | 在七个 NLP benchmark 上，多数收益来自 majority voting；同质 debate 在所建模条件下不提高期望正确性 | Debate or Vote | Choi, Zhu, Li, NeurIPS | 2025 | seven NLP benchmarks | https://proceedings.neurips.cc/paper_files/paper/2025/file/934252acd87f254d5d4672fbde283bd2-Paper-Conference.pdf | 同行评审，具有理论与代码；主要受控设定是同质 agents | 与 P3、P9 方向一致 |
| P3 | voting 在 reasoning 任务可优于 consensus，knowledge 任务可能相反；增加 agent 比增加 round 更稳 | Voting or Consensus? | Kaesberg et al., Findings ACL | 2025 | knowledge/reasoning tasks | https://aclanthology.org/2025.findings-acl.606/ | 同行评审；结果对任务和协议敏感 | 与 P2 形成条件化共识 |
| P4 | PairRanker + GenFuser 的多模型 ensemble 显示“选择/融合”本身是强基线 | LLM-Blender | Jiang et al., ACL | 2023-07 | MixInstruct and instruction tasks | https://aclanthology.org/2023.acl-long.792/ | 同行评审；较早模型池，但 baseline 结构仍重要 | 与 P5 共同支持简单聚合基线 |
| P5 | 分层 Mixture-of-Agents 在 AlpacaEval 2.0、MT-Bench、FLASK 上优于其单模型对照 | Mixture-of-Agents | Wang et al. | 2024-06-07 | 2024 open models/benchmarks | https://arxiv.org/abs/2406.04692 | arXiv/作者结果；开放式 judge benchmark 可能有长度/风格偏差 | 需由 judge-bias 来源约束解释 |
| P6 | 多采样/多 agent 数量本身能带来收益，是所有 debate 研究必须控制的 test-time-compute baseline | More Agents Is All You Need | Li et al., TMLR | 2024-10 | reasoning benchmarks | https://openreview.net/forum?id=bgzUSZ8aeg | 同行评审；“agent”主要是 ensemble，不等于交互式协商 | 与 P2 一致 |
| P7 | 选择性触发 debate 可显著降 token，并避免把原本正确的单模型答案改错 | iMAD | Fan, Yoon, Ji, AAAI | 2026-03-14 | six QA/VQA datasets | https://ojs.aaai.org/index.php/AAAI/article/view/40181 | 同行评审；报告“最高”92% token 减少/13.5% accuracy 增益，不应视为跨任务保证 | 支持 MMD 自适应方向 |
| P8 | 模型路由可在强弱模型之间学习成本—质量权衡 | RouteLLM | Ong et al., ICLR | 2025 | preference data/public benchmarks | https://openreview.net/pdf?id=8sSqNntaMr | 同行评审；路由到单模型，不是多模型协商，但方法可用于 gate/panel selection | 与 P7/FrugalGPT 思路互补 |
| P9 | 多样初始观点与校准 confidence 可让 debate 超过 vanilla vote；vanilla MAD 常低于简单 vote | Demystifying Multi-Agent Debate | Zhu et al., Findings ACL | 2026-07 | six reasoning QA benchmarks | https://aclanthology.org/2026.findings-acl.1694/ | 同行评审且很新；需独立复现 | 限定并扩展 P2/P3 |
| P10 | judge 受到 misinformation、authority、beauty、gender 等偏差影响 | Humans or LLMs as the Judge? | Chen et al., EMNLP | 2024-11 | thousands of judgments | https://aclanthology.org/2024.emnlp-main.474/ | 同行评审；直接支持多 judge、人评校准 | 与位置偏差研究一致 |
| B1 | LiveBench 提供自动评分、多域、持续更新的低污染任务 | LiveBench | White et al. | 2024-06; latest release varies | rolling releases | https://arxiv.org/abs/2406.19314 | 一手基准论文；应固定 release date | 与官方 repo 交叉核对 |
| B2 | HLE 是困难、跨学科、含多模态的闭集 benchmark；本项目已有 adapter | Humanity's Last Exam | CAIS/Scale AI/HLE Consortium | Nature 2026 | benchmark created 2025 | https://www.nature.com/articles/s41586-025-09962-4 | 同行评审；昂贵，题目/答案可能更新，需固定版本并保留 invalid item policy | 本地 adapter 可执行但未提供团队完整跑分 |
| E1 | LiteLLM 提供 custom provider 接口；社区当前支持外部 handler，但集成/发现仍有活跃兼容问题 | LiteLLM repo/docs/issues | BerriAI | living project | accessed 2026-07-14 | https://github.com/BerriAI/litellm ; https://github.com/BerriAI/litellm/issues/20064 | 一手开源资料；接口变化快 | 与本地 LiteLLM 分支实现交叉核对 |

## Missing Or Unverified Data
- MMD 尚无公开、完整、可复现的真实模型组合 benchmark 结果：data missing；当前仓库主要是框架与 HLE adapter。
- OpenRouter Fusion 的完整内部 prompt、原始 panel/judge outputs、每个配置逐任务成本与多次独立生成结果：unable to verify from公开材料。
- MMD main 与 LiteLLM 分支在同一批真实模型/任务上的等价性：未验证；两者应作为两个实现后端跑 contract parity，而不能混为一个实验条件。
- 闭源模型的训练数据、静默版本升级和真实随机种子：不可完全控制；必须记录 provider、snapshot、时间和响应 metadata。
- 研究预算的美元数：不能在没有 pilot 的实际 token/搜索费用前准确给出；应以 pilot 账单估计并冻结预算层。

