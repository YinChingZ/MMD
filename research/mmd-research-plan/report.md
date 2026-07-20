# MMD 研究规划（Final v2）

日期：2026-07-14  
对象：MMD 六人研究团队

## 一、结论先行

MMD 已经具备做严肃实证研究最难得的基础：不是只返回一个“融合答案”，而是保存独立提案、互评、修订、候选归并、显式投票、共识强度和来源链。main 分支是完整 Web/BYOK/事件流产品，`litellm-integration` 是更适合批量研究与潜在上游贡献的 Python custom-provider 路径。项目下一阶段不应继续以功能扩展为主，而应把现有 trace 变成**实验台账、可复现 benchmark harness 和过程指标数据集**。

首篇论文不宜把研究命题写成“多模型是否优于单模型”。这已被 LLM-Blender、Mixture-of-Agents、multi-agent debate 和 OpenRouter Fusion 反复探索。更有价值、也更符合 MMD 独特能力的问题是：

> 在相同成本或相同 test-time compute 下，异构模型组合何时优于单强模型、同模型多采样和简单投票？互评/修订究竟在什么任务上把错误改正，在什么任务上导致从众和正确答案被推翻？

建议形成三层研究计划：

1. **Paper A：机制与 Pareto 前沿。** 分解模型多样性、额外采样、角色分配与协议阶段的贡献。
2. **Paper B：自适应 MMD。** 学习何时不审议、何时 quick、何时 standard、选择哪些模型以及何时早停。
3. **Paper C：共识校准与人工升级。** 研究 disagreement、critical objection 和 source lineage 能否作为可靠的错误/风险信号。

与 OpenRouter Fusion 的竞争策略不应是复刻其默认面板。Fusion 的强项是托管、低摩擦、按需调用和内置搜索；MMD 的差异化应是**开放、可审计、协议可消融、可测量分歧与错误传播**。Fusion 是必须纳入的强产品基线，但不是唯一学术基线。

## 二、项目现状与研究资产

### 2.1 两个分支的角色

| 维度 | `main` | `litellm-integration` | 研究建议 |
|---|---|---|---|
| 定位 | Web decision workbench、API、CLI、BYOK | LiteLLM custom provider/strategy engine | 共享 protocol spec；实验优先走 LiteLLM，演示与人工研究走 Web |
| 协议 | quick/standard/planning；六阶段；Web search/multimodal/JSON output 已在 roadmap 实现 | quick/standard/planning；policy `off/required/auto` | 以 branch commit SHA 固定实现，不用分支名代替版本 |
| 模型接入 | OpenAI-compatible + BYOK provider 路由 | LiteLLM Router/`acompletion`，可发现 model groups | 批量实验复用 LiteLLM 的 provider、fallback、usage 生态 |
| 观测 | 阶段事件、item/token streaming、run cost/timings/quorum | `return_trace`、`return_analysis`、聚合 usage、logging payload | 设计一个跨分支统一的 `mmd.trace.v2` |
| 主要缺口 | 无实验 manifest/批量 runner/统计导出；README 的 M6 状态滞后 | 无完整内层 tool execution loop；与 main 未做 parity benchmark | 先做 contract parity 与 benchmark layer |

MMD `standard` 在 N 个模型时核心调用量约为 `4N+2`：propose、critique、revise、vote 各 N 次，normalize 与 compose 各一次；N=3 时为 14 次。`quick` 为 `N+2`；planning 约为 `1 + T(4N+2)`，T 是 topic 数。项目 HLE adapter 还会增加一次格式化调用。这个调用结构意味着 standard 的研究必须把 token、美元成本与延迟作为一级结果，而不是附录。

### 2.2 真正的技术独特性

- claim/candidate 级 `source_claim_ids` 让归并结果可追溯。
- 互评后每个模型可 keep/revise/withdraw，能测量错误转移方向。
- 共识标签由 ballots 的比例规则确定，不完全依赖单个 judge 的自由判断。
- quorum、partial failure 和 cost circuit breaker 使真实 API 实验可以报告失败和降级。
- standard/quick/planning 提供天然的协议消融起点。

但要避免过度主张：normalize 仍由单一 coordinator 形成候选集合，compose 也由单一 coordinator 决定最终文字。因此“无单一模型拥有裁决权”只在候选集合完整、compose 忠实的条件下成立。Normalize 是隐性的议程设置瓶颈；trace 能检测问题，却不能自动防止遗漏。这恰好是一个可发表的研究问题。

## 三、已有研究告诉了我们什么

### 3.1 已形成的共识

多次生成和多模型 aggregation 是强 baseline。LLM-Blender 用 ranking+fusion，Mixture-of-Agents 用分层聚合，More Agents Is All You Need 强调增加采样/agent 数本身的收益；因此任何 MMD 实验若缺少同模型多采样、投票和简单 judge synthesis，都会把额外计算误认成协议贡献。[LLM-Blender](https://aclanthology.org/2023.acl-long.792/)、[Mixture-of-Agents](https://arxiv.org/abs/2406.04692)、[More Agents Is All You Need](https://openreview.net/forum?id=bgzUSZ8aeg)

多轮 debate 有正向证据，但不是普遍规律。ICML 2024 的早期工作报告数学、策略推理与事实性改善；NeurIPS 2025 的受控研究则发现，七个 NLP benchmark 上多数收益来自 majority voting，并在其同质 agent 模型下证明 debate 更新不提高期望正确性。ACL 2025 的研究进一步给出任务条件：reasoning 任务常偏好 voting，knowledge 任务可能从 consensus 获益，增加 agent 往往比增加 round 稳。[Du et al.](https://proceedings.mlr.press/v235/du24e.html)、[Debate or Vote](https://proceedings.neurips.cc/paper_files/paper/2025/file/934252acd87f254d5d4672fbde283bd2-Paper-Conference.pdf)、[Voting or Consensus](https://aclanthology.org/2025.findings-acl.606/)

最新研究把“有效多样性”和“正确方向的非对称更新”放到了中心。2026 年的工作指出，初始观点多样性和校准置信度可让改进后的 debate 超过 vanilla vote；iMAD 则只在可能纠正初始错误时触发审议，报告最高 92% token 降低和最高 13.5% accuracy 改善，但这些是特定数据集的最大值，不是普遍保证。[Demystifying MAD](https://aclanthology.org/2026.findings-acl.1694/)、[iMAD](https://ojs.aaai.org/index.php/AAAI/article/view/40181)

### 3.2 文献留下的空白

1. 很多工作使用同质 agents；“不同厂商/家族”与真实错误互补性的关系还缺少系统、成本匹配研究。
2. 多数结果只看最终 accuracy，缺少 correct→wrong、wrong→correct、异议保留率和 candidate recall 等过程指标。
3. 美元成本、真实 latency、失败率经常弱于 token 报告。
4. 开放式研究和真实决策任务依赖 LLM judge，而 judge 有位置、权威、表面风格和 misinformation oversight 等偏差。[EMNLP judge-bias study](https://aclanthology.org/2024.emnlp-main.474/)
5. 自适应策略通常只决定“是否 debate”或“路由到哪个模型”，较少联合决定 panel、角色、协议深度和停止时机。

这些空白与 MMD 的 trace 和 LiteLLM 路径高度吻合。

## 四、OpenRouter Fusion：应当如何看待

Fusion 的公开拓扑是：外层模型决定是否调用 → 1–8 个 panel 模型并行回答 → judge 输出 consensus、contradictions、coverage gaps、unique insights 和 blind spots → 外层模型写最终答案；panel 和 judge 都可使用 web search/fetch。默认 3 panel 时，官方估计成本约是普通 completion 的 4–5 倍。[Fusion Router docs](https://openrouter.ai/docs/guides/routing/routers/fusion-router)

OpenRouter 于 2026-06-12 报告了 100 个 DRACO 任务的结果：Fable 5 + GPT-5.5、由 Opus 4.8 synthesis 得 69.0%；budget panel 得 64.7%；solo Fable 5 为 65.3%。同一个 Opus 4.8 采样两次再由 Opus 4.8 synthesis，从 solo 58.8% 提升到 65.5%。后一个结果尤其关键：Fusion 的收益并不只来自异构模型，随机推理路径、搜索来源差异和 synthesis 本身都可能贡献。[OpenRouter benchmark](https://openrouter.ai/blog/announcements/fusion-beats-frontier/)

这项研究做对了几件事：所有配置工具集合一致；发现模型能搜索到 rubric 后封锁污染域；披露 Fable 有 7 个任务被内容过滤；披露使用了与 DRACO 原文不同的 judge，因此不能直接比较绝对分数。

但证据边界也很明确：这是 vendor-run、单一的 100 题英语深度研究 benchmark；Fable 条件的分母不完全相同；完整逐任务原始 panel/judge 产物、多次独立生成分布和完整成本资产未从公开材料中验证。DRACO 本身也指出 judge 会显著改变绝对分数，并且只覆盖文本、英语和静态任务。[DRACO](https://arxiv.org/abs/2602.11685)

### MMD 与 Fusion 的实验性对照

| 维度 | Fusion | MMD | 可研究问题 |
|---|---|---|---|
| 默认路径 | panel + judge + outer answer | quick 或六阶段 standard | 多轮相对 quick 的增量价值 |
| 决策 | judge 结构化比较 | candidate + 显式 ballots + deterministic label | judge synthesis 与 vote 的偏差/校准 |
| 交互 | panel 不互评 | critique + revise | 纠错率 vs 从众/污染率 |
| 追溯 | 文档未承诺逐 claim lineage | schema 强制 source ids | lineage 是否提升可验证性/人审效率 |
| 工具 | panel/judge 搜索/fetch | main 仅特定 BYOK 路径在 propose/critique 搜索；LiteLLM 无完整内层 loop | tools-on 公平比较与搜索多样性 |
| 成本 | 默认约 4–5×单次 | quick `N+2`；standard `4N+2` | 实际 Pareto 前沿与选择性触发 |

## 五、推荐的研究问题序列

### Paper A：Beyond More Calls

建议标题：**Beyond More Calls: When Does Heterogeneous Multi-Model Deliberation Beat Sampling and Voting?**

主要 RQ：

- RQ1：固定美元预算或 token 预算时，异构 panel 是否优于同模型多采样和单个更强模型？
- RQ2：quick、vote-only、critique/revise、standard 中哪个阶段产生可重复的增量？
- RQ3：有效多样性（错误相关性、初始答案熵、oracle coverage）能否预测组合增益？
- RQ4：强模型的边际预算应花在 panel、normalize coordinator 还是 compose coordinator？
- RQ5：critique/revise 的 wrong→correct 与 correct→wrong 转移如何随任务、模型家族和多数压力变化？
- RQ6：MMD 共识标签是否校准：strong/qualified/disputed 对应的真实错误率和覆盖率是多少？

预期贡献不是一个 leaderboard，而是三个可复用产物：成本—质量—延迟 Pareto 图、阶段因果消融、带 lineage 的错误传播数据集。

### Paper B：Adaptive MMD

利用 Paper A 数据学习层级策略：

1. 先决定 solo / quick / standard / abstain。
2. 再从可用模型中选择 2–5 个 panel 成员和 coordinator。
3. propose 后根据 disagreement、置信度、任务特征和预计成本决定直接 compose、进入 vote、进入 critique/revise 或升级人工。
4. 以预算约束下最大化质量为目标，报告 coverage-risk 和 Pareto regret。

先用可解释 logistic/tree router，再与 RouteLLM 风格 preference router、iMAD gate 和静态 heuristic 比；不要第一版就上复杂强化学习。训练/验证/测试按领域和时间切分，防止同题泄漏。[RouteLLM](https://openreview.net/pdf?id=8sSqNntaMr)

### Paper C：Disagreement as a Product

核心不再是提高平均分，而是回答：

- disputed/critical objection 能否提前发现 hallucination 或危险建议？
- source lineage 是否缩短人类核查时间、提高错误定位率？
- 何种 dissent 应保留，何种是低质量 veto？
- consensus strength 经校准后能否支持 selective prediction 和人工升级？

这条线最能把 MMD 与 Fusion 的“更好最终答案”定位拉开。

## 六、Paper A 的可执行实验设计

### 6.1 任务分层

不要把所有任务混成一个均分：

| Block | 目的 | 首选来源 | 评分 |
|---|---|---|---|
| 闭集 reasoning/knowledge | 高功效、确定性验证 debate vs vote | 固定版本的 LiveBench reasoning/math/data、MMLU-Pro/GPQA 子集 | exact/官方 scorer |
| frontier academic | 利用现有 adapter、观察高难任务 | HLE text-only 分层子集；finalists 再扩全量 | HLE official judge + invalid-item policy |
| 开放 deep research | 与 Fusion 直接对照 | DRACO 100；工具和污染域严格一致 | rubric 多 judge + 人评子样本 |
| 中文/跨文化 extension | 检验模型家族与语言多样性 | 团队构建的双语等价子集或已验证多语 benchmark | 确定性优先；否则双语人评 |

首篇主结果建议用闭集任务，DRACO 作为外部效度与 Fusion 对照，中文作为 extension。不要一开始加入 SWE-bench 长时工具任务，因为 MMD/Fusion 的工具执行边界不同，会把 agent harness 能力混入模型组合效应。

### 6.2 模型池与组合筛选

冻结 6–8 个可用 snapshot，覆盖：

- 3 个不同家族的 frontier/strong reasoning 模型；
- 2–3 个不同家族的 budget/fast 模型；
- 1–2 个 open-weight 或低成本 specialist。

模型名和价格变化很快，因此论文只在 preregistration 时确定具体 snapshot，并保存 provider、route、版本、日期、reasoning setting 和价格快照。

不要跑所有组合的全因子。建议先在约 120 个分层任务上运行单模型，形成 ability、cost、latency 与 pairwise error-correlation 矩阵，再选：top-quality、lowest-cost、highest-diversity-at-matched-ability、same-family homogeneous、cross-family heterogeneous、specialist-balanced 六类 panel。120 是用于估计方差和筛选组合的工程起点，不是声称有充分统计功效的最终样本量；confirmatory 的任务数与重复数必须由 pilot 的 task-level variance、最小有意义效应和预算约束共同模拟决定。

为避免把“强模型更多”混成“多样性更高”，核心对照应在平均 solo ability、预计美元成本和 panel size 上匹配：同一能力/成本分层内比较高、低错误相关性的 panel；回归中预先加入成员 solo score、成本和输出长度。模型组合无法随机化到训练来源，因此结论应表述为受控关联与协议效应，不能声称识别了“厂商多样性”的纯因果效应。

### 6.3 必需 baselines 与消融

| Family | Condition | 作用 |
|---|---|---|
| Solo | 每个模型单次；最强单模型；成本匹配单模型 | 最低线与购买更强模型对照 |
| Sampling | 同模型 K=3/5 独立采样 + deterministic majority/self-consistency | 控制额外 compute 与随机多样性 |
| Simple ensemble | 异构 K=3 初始答案 + majority vote；LLM-Blender/MoA-style synthesis | 控制“多模型但不 debate” |
| MMD | quick；propose→normalize→vote→compose；standard | 分解 vote 与 critique/revise |
| Role ablation | 弱/中/强 coordinator；coordinator in/out of panel；匿名/随机顺序 | 测 single-authority bottleneck |
| Competitor | OpenRouter Fusion default/custom panel | 产品基线；只做 naturalistic Pareto，不声称内部因果等价 |

再加两个 MMD 特有消融：normalize candidate order 随机/盲化，以及 critical objection rule（veto、加权、阈值）对可靠性和恶意/弱模型鲁棒性的影响。

### 6.4 两条公平性轨道

1. **Naturalistic track**：按各系统推荐配置运行，回答用户实际买到的质量/成本/延迟。
2. **Compute-matched track**：统一总美元预算、最大 completion/reasoning tokens、工具权限和最大搜索步数，回答协议机制是否有增量。对于不支持 seed、temperature 或可见 reasoning token 的闭源模型，只记录实际支持的参数并依赖独立重复；不得把“请求中写了同一参数”当作“供应商实际执行等价”。

Fusion 内部 token 难以完全控制，因此它主要进入 naturalistic track；MMD 内部消融进入 compute-matched track。两者不能混在一个“公平胜负”表中。

### 6.5 指标

最终结果：accuracy/rubric score、citation correctness、instruction following、harmful error、abstention。  
资源：actual USD、input/output/reasoning token、search/tool fee、总 latency、TTFT、p50/p95、失败率、partial quorum、repair 次数。  
过程：initial answer entropy、pairwise error correlation、oracle coverage、candidate recall、unique correct claim coverage、dissent survival、wrong→correct、correct→wrong、position change、veto precision/recall。  
校准：Brier/ECE、strong/qualified/disputed 的 empirical risk、coverage-risk curve。  
组合效率：Pareto frontier、相对最佳单模型的增量成本效果 `Δquality / ΔUSD`。

### 6.6 统计与评测纪律

- 所有系统跑同一批 task 的 paired design；task 是主要抽样单元。
- pilot 用 2 个重复估计方差，confirmatory 主要条件至少 3 个独立重复，finalist 5 个。
- 95% cluster bootstrap CI；二元正确性用分层 logistic/mixed-effects，task 与 model/panel 作为随机效应。
- 预注册 primary contrasts；多重比较使用 Holm 或 FDR；不根据 pilot 结果偷偷更换主指标。
- 开放任务至少 3 个不同家族 judge，候选顺序随机并反转，模型身份匿名；先对约 15–20% 做双人盲评以估计 judge-human alignment 和标注方差，再按 pilot 一致性与目标置信区间扩大或缩小人评比例。这个比例是预算规划起点，不是固定统计规则。
- 保存 intent-to-treat（失败/过滤计入）与 per-protocol 两套结果；主结论以 intent-to-treat 为准。
- tools-on 条件封锁 benchmark rubric/answer 域并保存检索日志，复用 OpenRouter 已暴露的污染教训。

## 七、工程路线：先把框架变成实验平台

### 7.1 四周基础设施冲刺

必须新增：

1. `ExperimentManifest`：git SHA、branch/backend、dataset release/hash、prompt version、model snapshot、provider/route、temperature/seed、reasoning、tool config、budget、price snapshot。
2. `CallLedger`：每个内层调用的 role/phase/model、开始结束时间、usage/cost、retry/repair、error、request hash、response artifact pointer。
3. `mmd.trace.v2`：main 与 LiteLLM 统一字段；保持 v1 迁移器。
4. batch runner：resume、rate limit、idempotency、failure injection、分层采样、预算预估与 hard cap。
5. evaluator：closed scorer、HLE、DRACO rubric、multi-judge、human annotation export。
6. analysis notebook/script：paired bootstrap、mixed model、Pareto、stage-transition graph、data quality checks。
7. 合规清单：逐一核对 benchmark license、模型/provider 服务条款、响应留存许可、个人信息与高风险内容处理；公开 trace 前删除 secrets、用户数据和受限制的 benchmark 原文。

在真实大跑前，要求 main 与 LiteLLM 对 mock fixture 产生语义等价的 candidates/votes/classifications；否则两个分支不可合并分析。

### 7.2 数据结构上的关键新增

现在 run-level `timings`/`cost` 不足以解释机制。应保存 call-level ledger，并给每个 candidate 增加：是否被任何 proposer 提出、被 normalize 保留/合并/遗漏、各模型初始与修订立场、ballot、最终文本是否引用。原始 prompt/response 可加密或只保存 hash + 脱敏 artifact；公开数据集发布 claims/labels 时执行许可证和隐私审查。

## 八、六人团队分工与 32 周节奏

| Role | 主责 | 必须交叉复核 |
|---|---|---|
| R1 研究负责人/统计 | preregistration、识别策略、统计、论文叙事 | 不单独拥有结果解释；R5 复核分析 |
| R2 实验平台 | manifest、runner、ledger、main instrumentation | R3 做 LiteLLM/backend parity review |
| R3 LiteLLM/系统 | custom provider、router、usage/cost、上游接口 | R2 复核可复现性与失败恢复 |
| R4 benchmark/eval | dataset adapter、judge protocol、人评规范 | R6 复核数据质量与污染 |
| R5 算法/多样性 | panel selection、协议消融、adaptive policy | R1 复核统计泄漏与过拟合 |
| R6 复现/分析/发布 | data QA、独立复跑、artifact、文档、图表 | 不参与首轮主结果生成，保持一定独立性 |

时间线：

- W1–4：trace v2、runner、parity、20 题 dry run。
- W5–7：120 题 model/panel pilot；锁定模型池、任务和主 contrasts；按 pilot 账单确定总预算。
- W8–13：Paper A confirmatory closed-task runs；每周冻结一次不可变 artifact。
- W14–16：DRACO/Fusion 外部效度、人评校准、failure rerun。
- W17–20：统计分析、skeptical replication、Paper A draft/release。
- W21–25：Adaptive MMD 训练与 held-out domain/time evaluation。
- W26–28：Paper B draft；LiteLLM design issue/小型通用贡献。
- W29–32：共识校准/人工升级 pilot，决定是否发展 Paper C。

团队每周只开三类例会：实验变更审批、data quality review、paper claim review。任何 prompt/model/dataset 改动都产生新 manifest version，不能覆盖旧结果。

## 九、预算策略

现在不建议给出一个看似精确的总美元数字，因为闭源模型价格、reasoning token、搜索费和输出长度都未通过 pilot 测量。采用三道闸：

1. 20 题 dry run：确认 ledger 完整、失败模式和单条件成本。
2. 120 题 pilot：估计每个 condition 的均值/尾部成本和效应方差。
3. confirmatory：按预注册功效模拟和固定美元上限分配；先跑便宜筛选，再只对 Pareto 候选使用 frontier models/DRACO。

可用 60% confirmatory、20% 重复/失败重跑、10% judge/human eval、10% 探索作为初始预算模板，再由 pilot 调整。供应商集中度应作为运行风险报告；如果关键模型只能来自单一 provider，不强行满足比例上限，而是准备替代 route、保存中间产物，并在论文中披露依赖。

## 十、LiteLLM 贡献策略

短期把 `litellm-integration` 作为独立可安装 package 和研究后端，发布：trace schema、batch example、secret-free proxy e2e、真实 provider 的可选 smoke test。LiteLLM 当前已有 custom provider 机制，但接口和 custom provider discovery 仍在演进；先用小 design issue 讨论 generic orchestration lifecycle、nested usage/callback、recursion、stream-after-aggregation 和 audit metadata，比直接提交整套 MMD 算法更符合 gateway 边界。[LiteLLM repository](https://github.com/BerriAI/litellm)、[custom-provider discovery issue](https://github.com/BerriAI/litellm/issues/20064)

合入优先级：

1. 文档/示例：如何写多模型 orchestration provider。
2. 通用 trace/callback/depth helper（仅在维护者认可缺口后）。
3. 最后才讨论 first-party `mmd` provider；保持策略包为外部 opt-in dependency。

研究资产会显著提高上游成功率：维护者更容易接受“有 reproducible benchmark、契约测试和外部用户”的通用扩展，而不是只有功能主张的大 PR。

## 十一、决策门槛与失败也有价值

W7 后作第一次 Go/No-Go：若 heterogeneous panel 的 oracle coverage 没有高于同质采样，或错误高度相关，就缩小到“协议/校准”而不是组合优化。W16 后：

- 若 standard 在 compute-matched 条件下稳定优于 vote-only/quick，Paper A 主张多轮机制；
- 若不优于，论文主张“审议的边界”，并用 stage trace 解释从众与正确答案被推翻；
- 若平均分无增益但 disagreement 能预测错误，转向 selective prediction/人工升级；
- 若三者都不成立，MMD 更适合作为审计产品而非性能提升算法，研究应停止扩张并公开负结果。

这四种结果都可行动。最危险的路线反而是只跑少量漂亮案例、只和一个弱 solo baseline 比，然后宣称“共识更可靠”。

## 十二、最终建议

马上做的不是全量 HLE，也不是复制 OpenRouter 的 DRACO 图，而是四周建立跨分支实验层，并用 120 题 pilot 构建第一张“模型能力 × 错误相关性 × 成本”的矩阵。首篇研究围绕固定预算下的模型多样性与协议增量；OpenRouter Fusion 进入 naturalistic external baseline；MMD 内部则用 compute-matched ablation 做真正的机制识别。

如果只能选择一个最有胜算的核心贡献，应选择：

> 用 claim-level trace 证明“有效多样性 + 受控的非对称纠错”何时产生价值，并把 disagreement 从需要被消除的噪声，转化为可校准的计算和人工升级信号。

这比“六个模型一起讨论会更聪明”更难，但也更独特、更可复现，且能同时形成论文、开源 benchmark harness、LiteLLM 贡献和产品差异化。
