# Paper A 研究方案：多模型协作的性能来源与成本—性能边界

版本：v0.4（动态执行规划稿）  
日期：2026-07-16  
状态：未预注册；关键研究决策已确认，D8/D9 数值与 D12 发布矩阵按 Stage 0/G2 流程完成  
主要实验实现：MMD `main` 与 `litellm-integration`；正式实验须固定 commit SHA

---

## 0. 如何审阅这份文档

本方案使用三类标记：

- `D#`：研究决策；确认状态、owner 与 gate 见第 20 节；
- `G#`：进入下一阶段前必须满足的质量门槛；
- `H#`：预注册的研究假设。

建议按以下顺序审阅：

1. 先确认第 2–4 节的论文问题、主张边界和主假设；
2. 再确认第 7–10 节的任务、模型池和实验条件；
3. 然后确认第 11–15 节的指标、统计与有效性控制；
4. 最后根据第 17–20 节确定工作量、动态责任配置、预算和待办。

任何 `D#` 改动都应同步更新实验 manifest 和版本号；预注册之后不得覆盖旧版本。

---

## 1. 一页式摘要

### 1.1 研究问题

本研究关注多模型协作系统中性能变化的来源及其适用条件。核心问题是：

> 多模型协作相对于单模型推理所产生的性能变化，分别有多少来自额外采样、模型间的有效多样性、答案聚合、模型间交互以及协调模型？这些机制在什么任务和运行条件下能够纠正错误，又在什么条件下导致从众、遗漏、错误传播或不必要的成本？

在此基础上，本研究进一步检验：

> 在控制成员模型能力、模型调用数量、计算预算或真实美元成本后，异构模型组合和结构化审议是否仍能产生超越同模型多采样、简单投票及单模型综合的增量价值？

研究将 MMD 作为主要实验载体，因为其分阶段协议和结构化 trace 允许观察、干预并消融多模型协作过程。研究结论原则上针对所检验的协作机制和实验条件，而不预设 MMD 本身优于其他框架，也不将单一框架上的结果直接推广至所有多模型系统。

### 1.2 研究对象

研究对象不是 MMD 框架本身，也不是某一组“当前最强模型”的 leaderboard，而是以下多模型协作机制：

1. **Sampling effect**：同一模型多次生成产生的随机多样性；
2. **Model diversity effect**：不同模型错误模式的互补性；
3. **Aggregation effect**：投票或单模型 synthesis 的增益；
4. **Deliberation effect**：critique/revise 是否产生超越 aggregation 的增量；
5. **Coordinator effect**：normalize/compose 模型的能力与偏差；
6. **Task interaction**：上述机制是否随 reasoning、knowledge、instruction-following 和开放研究任务变化。

### 1.3 最小可发表贡献

即使结构化多模型审议没有取得最高平均准确率，本研究仍应交付：

- 一项对多模型协作性能来源及其任务依赖性的实证分解；
- 一个成本、质量、延迟匹配的 multi-model deliberation benchmark harness；
- 一组区分 sampling、diversity、aggregation 与 deliberation 的预注册对照；
- wrong→correct、correct→wrong、候选遗漏和异议保留的过程分析；
- 模型错误相关性和初始分歧对组合收益的预测分析；
- 结构化审议、简单投票和单一 judge synthesis 的 Pareto 前沿。

---

## 2. 论文定位

### 2.1 工作标题

**推荐标题：**

> Where Do Multi-Model Gains Come From? Decomposing Sampling, Diversity, Aggregation, and Deliberation

备选：

- *Beyond More Calls: When Does Heterogeneous Multi-Model Deliberation Beat Sampling and Voting?*
- *The Cost of Deliberation: Decomposing Diversity, Voting, and Revision in Multi-LLM Systems*
- *Do Models Need to Talk? A Cost-Matched Study of Heterogeneous LLM Deliberation*

`D1 — 标题与主叙事（已确认）`  
Paper A 将性能来源分解作为总问题，把有效多样性和结构化审议的增量价值作为两个主要确认方向。

### 2.2 文献中的位置

研究直接承接四类工作：

1. 多模型 selection/fusion：LLM-Blender、Mixture-of-Agents；
2. 多模型采样与投票：More Agents Is All You Need、self-consistency；
3. 多智能体 debate：Du et al.、Debate or Vote、Voting or Consensus、Demystifying MAD；
4. 托管式或产品化 multi-model synthesis 系统。

现有证据存在明确冲突：早期工作报告 debate 提高 reasoning 和 factuality；后续受控研究发现 majority vote 可以解释大量收益，且任务类型、观点多样性与置信度会改变结果。本研究的价值是把多模型协作视为一组可分解机制，并利用 MMD 的阶段 trace 作为观测与消融工具，在现代异构闭源/开放模型上同时研究最终效果和错误转移机制。MMD 是本研究的主要实现，不是待证明优越性的研究对象。

### 2.3 主张阶梯

论文只应根据结果选择能够被数据支持的层级：

| 层级 | 可允许的主张 | 所需证据 |
|---|---|---|
| L1 描述性 | 不同协议形成不同成本—质量前沿 | 完整、重复、可复现运行 |
| L2 关联性 | 低错误相关性/高初始分歧预测较大组合收益 | 跨任务、跨 panel 的 held-out prediction |
| L3 协议效应 | critique/revise 相对 vote-only 产生净纠错 | 同 panel、同任务、预注册 paired ablation |
| L4 受限一般化 | 某机制在特定任务族、预算和模型池中稳定成立 | 多任务块、独立重复、交互项 |
| 禁止 | “异构模型普遍优于单模型”或“厂商多样性导致正确性” | 本设计无法支持普遍或训练来源因果主张 |

---

## 3. 概念模型：最终增益来自哪里

对任务 (x)、panel (S)、协议 (p)，定义最终质量：

\[
Q(x,S,p)=Q_{base}+G_{sample}+G_{diversity}+G_{aggregation}+G_{deliberation}+G_{coordinator}+\varepsilon
\]

这不是拟合时必须采用的线性结构，而是实验设计的分解框架：

- (G_{sample})：同一模型多次调用即可获得的收益；
- (G_{diversity})：不同错误通道提供的补充信息；
- (G_{aggregation})：投票、选择或 synthesis 的收益；
- (G_{deliberation})：看到他人答案、批评和修订的额外收益；
- (G_{coordinator})：候选归并和最终写作模型自身带来的变化。

本研究不假设这些项都为正。尤其是：

- critique/revise 可能产生 correct→wrong；
- normalize 可能遗漏正确少数意见；
- coordinator 可能依靠自身能力纠正 panel，也可能重写掉真实分歧；
- 多模型可能因为共同训练数据而形成 false consensus。

---

## 4. 研究问题与预注册假设

本节区分三类内容：性能来源的分解问题、可以做确认性检验的假设，以及尚不适合预设方向的探索问题。第 3 节中的各项不是天然可相加或彼此独立的因果成分；每个“来源”只能通过明确的协议对照来估计。除非下文另有说明，所有效应均指同一批 task 上的 paired task-level effect，并同时报告质量、实际成本、延迟和失败率。

### 4.1 RQ1：多模型协作的性能变化来自哪些步骤？

**RQ1：** 相对于单模型回答，多模型协作的最终质量变化分别出现在哪些步骤：增加同模型采样、引入异构模型、改变聚合方式、加入显式投票，以及加入 critique/revise？每一步带来的质量变化是否足以补偿其成本、延迟和系统失败风险？

RQ1 通过第 9 节的嵌套对照回答：

| 待估计增量 | 主要对照 | 可以支持的解释 | 不能单独支持的解释 |
|---|---|---|---|
| Sampling increment | C1 − matched C0 | 同一模型增加独立样本后的净变化 | 模型多样性或模型交互的作用 |
| Diversity increment | C2 − C1 | 在能力与成本匹配下，异构成员相对同模型采样的净变化 | 厂商或训练来源的因果效应 |
| Synthesis increment | C3 − C2 | 单 coordinator synthesis 相对确定性投票的净变化 | coordinator 利用 panel 信息还是独立解题 |
| Explicit-ballot increment | C5 − C4 | 显式 ballot 阶段在可追溯协议中的净变化 | ballot 之外所有协议设计的一般优势 |
| Deliberation increment | C6 − C5 | critique/revise 在其余阶段相同条件下的净变化 | 所有 debate 或多智能体系统的一般效果 |

RQ1 是分解性研究问题，不预设每个增量为正。为减少随机生成造成的混杂，C2/C3 以及 C4/C5/C6 在协议允许时应复用同一组匿名化 initial proposals，并从共同的上游 artifact 分支运行。无法复用时，必须依赖独立重复并降低因果措辞。

### 4.2 RQ2：有效多样性是否产生超越同模型采样的增量价值？

**RQ2：** 在 panel size、成员平均 solo ability、输出上限和预计成本预先匹配后，低错误相关性的异构 panel 是否比同模型多采样或高错误相关性 panel 获得更大的 aggregation gain？

主要估计量是 held-out confirmatory tasks 上的 C2 − C1 paired quality difference；辅助分析比较多个合格 panel 的 screening error correlation 与 held-out panel gain。panel 的选择和相关性计算只能使用 screening split，不能使用 confirmatory 结果。

`H1 — 有效多样性的增量假设`  
在预注册的匹配容差内，P-diverse 的 C2 − C1 task-level 平均质量差高于 P-family/P-homo 的对应差值。统计检验回答效应是否高于零；是否具有实际价值则由团队预先确定的最小有意义质量差 \(\delta_Q\) 与成本约束共同判断。

**解释边界：** H1 即使成立，也只支持“以 screening error correlation 定义的有效多样性与增量收益相关，并在所测试 panel 中形成受控差异”；它不支持“跨厂商”本身导致性能提升。若无法找到满足能力与成本匹配的 panel，H1 不进入确认性检验，RQ2 降为带协变量的关联分析。

### 4.3 RQ3：结构化审议在何时产生净纠错？

**RQ3：** 在同一 panel、同一 task 和共同 initial proposals 上，加入 critique/revise 后，最终结果相对非交互式 vote-only 聚合发生多少 wrong→correct 与 correct→wrong 转移？这种净变化是否由审议前即可观察的初始分歧所调节？

主要估计量是 C6 − C5 的 paired quality difference、增量成本和增量延迟。鉴于现有文献对平均审议收益的方向并无稳定共识，本研究不预注册“C6 的总体平均质量必然高于 C5”。总体效应以 effect size 和置信区间回答，而不是通过缺乏依据的方向性假设回答。

`H2 — 分歧调节假设`  
审议前的 initial disagreement 越高，C6 − C5 的 task-level quality difference 越大。检验使用预注册的连续分歧指标；若为了展示而划分高/低分歧组，阈值必须由 screening 数据确定，不能根据 confirmatory 结果选择。

`H3 — 高分歧任务的净纠错假设`  
在按 screening 规则预先定义的高分歧任务中，从 C5 错误到 C6 正确的比例高于从 C5 正确到 C6 错误的比例。该假设检验审议是否产生净纠错；它不以输出变长、共识标签变化或更多模型修改答案作为成功标准。

**决策解释：** 即使 H2/H3 成立，结构化审议也只有在质量增益达到 \(\delta_Q\)，或在预注册的成本—质量规则下进入 Pareto 前沿时，才被判断为具有实际采用价值。

### 4.4 Secondary RQs：解释机制与边界

以下问题保留为 secondary/exploratory，不在当前版本中强行设置方向性假设：

- **RQ4 — Aggregator/coordinator：** synthesis、normalize 和 compose 的收益有多少来自整合 panel 信息，有多少来自 coordinator 自身直接解题能力？需要 coordinator-only、panel-blind 或角色替换消融后才能回答。
- **RQ5 — 信息保留：** 正确少数意见在 critique、revise、normalize、vote 和 compose 中分别在哪里被保留、合并或丢失？主要观察 candidate recall、dissent survival 和阶段性 correct→wrong 转移。
- **RQ6 — 任务边界：** sampling、diversity、aggregation 和 deliberation 的增量效应是否在预注册的任务块间不同？任务交互只用于限定适用范围，不将事后表现最好的 task 子集改写成主要发现。
- **RQ7 — 可预测性：** 仅使用运行前或审议前可获得的信号，能否在 held-out tasks 上预测结构化审议的收益或伤害？本研究只评估可预测性，不训练生产级自适应 router。

只有在 preregistration 前补齐对应消融、主要结果变量和多重比较归属后，RQ4–RQ7 中的问题才能升级为确认性假设。

### 4.5 预注册前必须由团队填写的判定项

以下内容未确定前，H1–H3 仍是研究方向，而不是可提交的预注册假设：

1. 最小有意义质量差 \(\delta_Q\)，以及可接受的增量成本或 ICER 规则；
2. panel 平均 solo ability 与预计成本的匹配容差；
3. error correlation 的主定义、screening/confirmatory split 和 panel 选择算法；
4. initial disagreement 的主指标，以及 H3 高分歧任务的预定义规则；
5. C1 对应的 matched C0、主要 coordinator 和 C4/C5/C6 的上游 artifact 复用规则；
6. H1–H3 的主要 task blocks、效应尺度、多重比较 family 和失败计分方式。

---

## 5. 研究范围与实验结构

### 5.1 确认性研究边界

RQ1–RQ3 和 H1–H3 的确认性证据来自同一个受控机制研究：

- tools off，避免搜索策略、来源质量、工具调用次数和检索污染改变待识别机制；
- panel size 固定为 N=3，模型数效应不与模型异构性或审议效应混合；
- R、K 为 primary task blocks，I 为 secondary；F 和开放研究任务只用于后续边界检查；
- primary outcomes 使用确定性或官方 scorer，Stage 1–3 不依赖 LLM-as-a-judge；
- 同一 confirmatory sampling frame、模型 snapshot、prompt、coordinator 和失败规则贯穿所有主要对照；
- Structural track 估计协议步骤的自然增量，Budget-matched track 检验这些增量是否优于相同预算的替代用法。

`D2 — 确认性实验是否 tools off（已确认）`  
Paper A 的 Stage 1–3 全部 tools off，以避免模型协作效应与检索行为效应混合。该决定不限制后续论文或 Stage 4 外部效度扩展研究 tools-on 场景。

### 5.2 Stage 0：Screening、pilot 与设计锁定

Stage 0 只用于构建设计，不能产生论文的确认性结论：

1. 在 screening split 上估计各模型的 solo ability、实际成本、失败率和 pairwise error correlation；
2. 根据预先声明的算法生成 P-diverse、P-family/P-homo 及必要的能力—成本匹配候选；
3. 用 pilot 检查 C0–C6 的可运行性、上游 artifact 分支、scorer 和 trace 完整性；
4. 估计 task-level variance，确定 \(\delta_Q\)、样本量、重复次数和成本上限；
5. 固定 initial disagreement 指标及 H3 的高分歧判定规则；
6. 锁定 confirmatory tasks、panels、coordinator、prompts、主要分析和排除规则。

如果找不到满足预注册能力与成本容差的高/低多样性 panel，H1 在进入 confirmatory 前撤回并记录原因；RQ2 只保留为关联性分析。不得为了保留 H1 而在看过 confirmatory 结果后放宽匹配标准。

### 5.3 Stage 1：RQ1 性能来源分解

Stage 1 在锁定的 task × panel × repetition 单元上运行 C0–C6，回答各协议步骤在哪里产生收益、损失和额外系统风险。

运行结构分为三条可比较分支：

- **Solo/sampling branch：** matched C0 与 C1，估计 sampling increment；
- **Heterogeneous aggregation branch：** 生成一组匿名化异构 initial proposals，并共享给 C2、C3 以及协议允许共享上游输入的后续条件；
- **Traceable protocol branch：** C4/C5 从相同 proposals 与 normalize artifact 分支；C6 从相同 initial proposals 进入 critique/revise，再继续 normalize、vote 和 compose。

每个分支都保存 task quality、实际成本、wall-clock latency、失败状态和阶段 trace。RQ1 的目标是估计每个预定义 contrast 的效应与不确定性，不根据结果选择一条“最成功”的路径作为唯一主结果。

### 5.4 Stage 2：RQ2/H1 有效多样性确认

Stage 2 使用 Stage 0 锁定的 panel 和 held-out confirmatory tasks：

- 分别为 P-diverse 与 P-family 锁定一个成员能力和预计成本匹配的 P-homo reference；异构 panel 运行 C2，对应的 P-homo reference 运行 C1；
- 主要检验 H1 规定的 difference-in-differences，而不只比较两个 panel 的最终分数；
- 使用 screening error correlation 解释 panel 类型，不用 confirmatory correctness 重新定义“多样”；
- 同时报告 matching balance、oracle coverage 和 unique correct coverage，区分模型互补性与成员能力差异；
- H1 的确认性结论只适用于通过 matching gate 的 panel。

Stage 1 和 Stage 2 是不同的分析模块，但可在同一批次中交错运行，以减少 provider 时间、负载或模型漂移与 condition 重合。

### 5.5 Stage 3：RQ3/H2–H3 审议净纠错确认

Stage 3 对每个 task × panel × repetition 保存共同 initial proposals，并分支运行 C5 与 C6：

1. 在任何 critique/revise 发生前计算 initial disagreement；
2. 对 C5 与 C6 使用相同的匿名顺序、coordinator、输出上限和下游失败规则；
3. 以 C6 − C5 估计平均质量、成本和延迟增量；
4. 用预注册的连续分歧指标检验 H2；
5. 用预定义高分歧规则和 paired error transition 检验 H3；
6. 分别报告 wrong→correct 与 correct→wrong，不用净值掩盖双向变化。

Stage 3 不以“更多模型修改了答案”或“最终形成共识”作为成功；成功标准必须来自质量变化与预注册的成本—质量判定规则。

### 5.6 Stage 4：数据锁定后的边界与解释分析

RQ4–RQ7 以及外部效度分析只在主要数据和主分析锁定后启动，可包括：

- coordinator-only、panel-blind、角色替换和顺序敏感性消融；
- candidate recall、dissent survival 和阶段性错误转移的 trace 分析；
- F 或开放研究任务上的小规模复现；
- 与公开论文或可访问外部多模型系统的结果进行同任务、同评分口径的上下文比较。

外部系统比较只回答“本研究结果与现实系统处于什么相对位置”。由于内部 prompt、调用拓扑、模型版本和资源预算通常不可完全对齐，它不参与 H1–H3，也不能用于归因本研究中的具体协议机制。

### 5.7 为什么不采用模型 × panel × 协议 × 任务的全因子设计

全因子设计既超出预算，也会产生大量没有直接对应 RQ/H 的比较。本研究采用顺序锁定和针对性对照：

1. Stage 0 只选择模型、panel 和阈值；
2. Stage 1–3 只运行回答 RQ1–RQ3 与 H1–H3 所需的条件；
3. Stage 4 只解释已锁定主结果的边界，不回头改变主要假设；
4. 所有未预注册的模型、panel、task 子集和协议组合明确标为 exploratory。

---

## 6. 实验单位与数据层级

| 层级 | 定义 | 主要用途 |
|---|---|---|
| Task | 一个 benchmark item | 主要统计抽样单元 |
| Run | 一个 task × condition × repetition | 最终质量、成本、延迟 |
| Inner call | 一个 phase × model 调用 | usage、错误、retry、阶段成本 |
| Claim | proposer 产生的原始主张 | 来源、正确性、修订 |
| Candidate | normalize 后的候选主张 | candidate recall、合并与遗漏 |
| Ballot | model 对 candidate 的投票 | 共识、异议与 veto |
| Panel | 一组成员模型及 coordinator | ability、diversity、cost profile |

主要推断单位是 task，而不是模型调用。重复调用是同一 task-condition 下的随机重复，不能伪装成独立样本。

---

## 7. 任务与数据集设计

### 7.1 推荐任务块

| Block | 推荐来源 | 主要能力 | 评分方式 | 在论文中的角色 |
|---|---|---|---|---|
| R：Reasoning | LiveBench reasoning/math、GPQA | 多步推理、科学问题 | exact/official | Primary |
| K：Knowledge | MMLU-Pro/GPQA 分层题目 | 专业知识+推理 | exact/official | Primary |
| I：Instruction | LiveBench instruction-following/data analysis 的可判分子集 | 格式、约束、分析 | official scorer | Primary/secondary |
| F：Frontier | HLE text-only 分层子集 | 高难专家知识 | official evaluator | Secondary |
| O：Open Research | DRACO | 搜索、综合、引用 | rubric multi-judge | External validity |

### 7.2 推荐的首轮范围

- Screening：约 120 个分层 task，用于估计单模型能力、成本和错误相关性；
- Confirmatory：样本量不预先拍定，由 screening/pilot 的 task-level variance 和最小有意义效应做模拟；
- Open Research：先做 10–20 题工程 pilot，再决定是否完整运行 DRACO 100。

120 是工程起点，不是统计功效声明。

`D3 — 主任务块（已确认）`  
R + K 为 primary，I 为 secondary，F/O 只进入 Stage 4。这样可以用确定性 scorer 完成主要机制判断，并把高难任务与开放研究场景限定为外部效度检查。

### 7.3 数据纳入与排除规则

正式运行前固定：

- dataset release、commit/hash 和 license；
- 题目语言与模态；
- 是否允许检索；
- 图片题是否排除；
- 无效/争议答案清单；
- 答案解析规则；
- provider content filter 的处理；
- 泄漏/污染风险。

不得根据某个系统的表现事后删除题目。发现 benchmark 错题时，必须在盲于 condition 的数据质量流程中决定，并同时报告包含/排除后的敏感性分析。

---

## 8. 模型池与 panel 选择

### 8.1 初始模型池

推荐冻结 6–8 个模型 snapshot：

- 3 个不同家族的 strong/frontier 模型；
- 2–3 个不同家族的 budget/fast 模型；
- 1–2 个 open-weight 或低成本 specialist；
- 至少两个能力相近但家族不同的模型，用于匹配多样性对照。

每个模型必须记录：

- 完整 model id/snapshot；
- provider 与 route；
- 调用日期；
- 支持的 temperature/seed/reasoning 参数；
- 输入/输出价格与额外费用；
- context limit；
- 工具和结构化输出兼容性；
- content-filter/失败行为。

`D4 — 具体模型池（已确认冻结规则）`  
具体 model id、provider route 和 price snapshot 在 Stage 0 screening 开始前冻结。screening 中途若模型不可用，应重跑受影响的 screening 条件并重新执行 panel selection；不得把替代模型直接并入原 screening 数据。具体模型名单根据团队可用 key、稳定性和价格临近 Stage 0 确认，不把论文提前绑定到可能下线的别名。

### 8.2 Screening 设计

每个模型在同一批约 120 个 task 上独立运行 2 次，得到：

- solo accuracy/score；
- 每题成本和 latency；
- answer distribution；
- pairwise correctness/error correlation；
- 每题置信/格式/拒答行为；
- 失败和不可解析率。

### 8.3 Panel 类型

从 screening 中选择，不全枚举所有组合：

| Panel ID | 定义 | 研究目的 |
|---|---|---|
| P-top | solo ability 最高的三个模型 | 强度上限 |
| P-budget | 成本较低且达到最低能力门槛的三个模型 | 低成本前沿 |
| P-diverse | 在 ability/cost 约束下错误相关性最低 | 有效多样性 |
| P-homo | 同一模型三次独立实例 | sampling 对照 |
| P-family | 同家族或高度相关的三个配置 | 低多样性对照 |
| P-specialist | 不同任务 specialist 的组合 | 专业互补扩展 |

P-diverse 与 P-family/P-homo 的比较必须尽可能匹配：

- panel size；
- 平均 solo score；
- 预计美元成本；
- 最大输出长度；
- reasoning setting。

如果无法同时匹配，预注册优先级为：panel size → solo ability → cost，并在模型中显式控制剩余差异。

### 8.4 “有效多样性”的操作化

至少使用四类指标：

1. **Answer disagreement**：初始答案不一致率或标准化熵；
2. **Error correlation**：pairwise correctness/error 的 phi/Pearson correlation；
3. **Oracle coverage**：至少一个成员正确的任务比例；
4. **Unique correct coverage**：只有某成员提供正确答案/正确 claim 的比例。

语义 embedding distance 仅作为补充，因为它可能主要反映文风。

---

## 9. 实验条件

### 9.1 核心条件

C4–C6 使用 MMD 对三类可追溯协作协议进行操作化。论文的机制结论应指向相应的聚合、投票或审议过程；“MMD Quick/Vote/Standard”仅表示本研究中的具体实现。

| ID | 条件 | 流程 | 主要识别对象 |
|---|---|---|---|
| C0 | Solo | 单模型直接回答 | 个体能力基线 |
| C1 | Homo-Sample-Vote | 同模型 K=3 独立回答，确定性投票 | sampling effect |
| C2 | Hetero-Vote | 异构 K=3 独立回答，确定性投票 | diversity over sampling |
| C3 | Hetero-Synthesis | 异构 K=3，单 coordinator 综合 | judge/aggregation effect |
| C4 | Traceable-Quick（MMD Quick） | Propose→Normalize→Compose | traceable aggregation |
| C5 | Traceable-Vote（MMD Vote） | Propose→Normalize→Vote→Compose | explicit ballot effect |
| C6 | Structured-Deliberation（MMD Standard） | Propose→Critique→Revise→Normalize→Vote→Compose | deliberation effect |

### 9.2 Primary contrasts

| Contrast | 回答的问题 |
|---|---|
| C2 − C1 | 异构模型是否超过同模型采样？ |
| Δdiverse − Δfamily，其中 Δ = C2 − matched C1 | 低错误相关性是否带来超越一般异构性的额外 aggregation gain？ |
| C3 − C2 | 单模型 synthesis 是否超过简单投票？ |
| C5 − C4 | 显式 vote 是否增加价值？ |
| C6 − C5 | critique/revise 是否有净增量？ |
| C6 vs best Pareto baseline | 结构化审议是否值得其成本？ |

`D5 — Primary confirmatory effects（已确认）`  
H1 的 diversity difference-in-differences 与 C6−C5 是两个 primary confirmatory effects。单独的 C2−C1 是 RQ1 的分解估计；H1 进一步比较低相关 panel 与匹配高相关 panel 的 aggregation gain。

### 9.3 条件性角色消融

只在核心结果表明 coordinator 可能影响结论时运行：

- strong vs budget coordinator；
- coordinator in-panel vs out-of-panel；
- normalize 与 compose 使用同/不同模型；
- panel identity 显示 vs 匿名；
- candidate/response order permutation；
- coordinator-only 直接回答。

`D6 — 角色消融是否进入主实验（已确认）`  
coordinator、角色替换、身份显示和顺序等消融不进入主实验；只在主要数据锁定后，根据确认性结果触发相应的 Stage 4 分析。

### 9.4 外部系统结果对照

外部多模型系统不进入确认性条件 C0–C6。主结果锁定后，可以选择公开方法或可访问系统做上下文比较：

- 尽可能使用相同任务、评分器、模型能力层和检索权限；
- 同时报质量、实际成本、延迟和失败率，不只比较公开总分；
- 分开报告系统自然配置与尽可能匹配的配置；
- 无法核对内部 prompt、调用拓扑或模型版本时，明确标为 naturalistic comparison；
- 不用外部系统结果解释 C0–C6 中某个阶段的因果作用。

`D7 — 是否运行外部系统对照（已确认）`  
外部系统对照是可选 Stage 4，不是 Paper A 完成或投稿的必要条件。只在 Stage 1–3 完成、数据锁定且存在可比任务与预算时进行；否则仅在讨论中与公开结果做限定性比较。

---

## 10. 单次运行与随机化流程

### 10.1 运行前冻结

每个 experiment batch 必须生成不可变 `ExperimentManifest`：

- experiment id/version；
- git SHA、backend 与 protocol version；
- dataset hash；
- model ids、provider、route；
- panel 和 coordinator；
- prompt version/hash；
- temperature、seed（若支持）、reasoning；
- max tokens、timeout、retry、repair；
- tool config；
- price snapshot；
- scorer/judge version；
- exclusion list。

### 10.2 随机化

- 对 task 的运行顺序随机化，避免时间/provider load 与 condition 完全重合；
- 在允许时交错运行 conditions，而不是先跑完一种条件；
- panel 回答匿名并随机排列给 coordinator；
- 对 synthesis/judge 做顺序反转敏感性检查；
- 同一 task × panel × repetition 内，预注册的嵌套消融可以共享 initial proposals，并从不可变上游 artifact 分支，以减少协议前随机差异；
- 不同 repetition 必须使用独立请求，不得复用上一次 repetition 的 proposals 或最终结果。

### 10.3 参数纪律

- 主实验使用统一 system/user prompt 意图；协议差异所需 prompt 除外；
- 闭源模型不支持 seed 时，记录为 unsupported，并用独立重复估计随机性；
- 不把 API 中相同的 temperature/reasoning 字段等同于相同内部计算；
- 不为单个模型手工优化 prompt，除非为所有模型采用预注册的兼容模板；
- 结构化输出失败按统一 repair/retry policy，所有额外调用计入成本。

### 10.4 失败与缺失

主分析采用 intent-to-treat：

- content filter、超时、不可解析、未达 quorum 都计入系统失败；
- 质量评分按预注册的失败分值处理；
- 成本计入失败前已经发生的所有调用；
- 同时报告 per-protocol 结果作为敏感性分析；
- 不用无限重试把失败隐藏掉。

---

## 11. 结果指标与操作定义

### 11.1 Primary outcomes

1. **Task quality**：官方 exact/scorer 的 task-level correctness 或 normalized score；
2. **Actual cost**：provider 返回或版本化价格表计算的 run-level USD；
3. **Pareto status**：一个 condition 是否被另一个 condition 在质量和成本上同时支配；
4. **Deliberation marginal value**：C6 相对 C5 的质量增量、成本增量和延迟增量。

### 11.2 Secondary system outcomes

- input/output/reasoning tokens；
- total wall-clock latency、p50/p95；
- TTFT（仅作为用户体验补充，不与完整审议延迟混淆）；
- success、timeout、content filter、parse failure；
- partial quorum；
- retry/repair 次数；
- unknown pricing 比例。

### 11.3 过程指标

#### Initial disagreement

对可规范化为离散答案的任务：

\[
D_{vote}=1-\frac{\max_y n_y}{N}
\]

同时报告标准化熵。开放 claim 使用语义聚类仅作补充。

#### Oracle coverage

\[
O(S)=\frac{1}{T}\sum_{t=1}^{T}\mathbb{1}(\exists m\in S: y_{m,t}\text{ correct})
\]

它表示聚合器在不创造新知识时的理论上限。

#### Net correction

\[
NC=P(\text{wrong}\rightarrow\text{correct})-P(\text{correct}\rightarrow\text{wrong})
\]

需要分别在 agent revision 层和最终 system 层计算。

#### Debate gain

\[
G_{debate}=Q_{standard}-Q_{pre\text{-}debate\ vote}
\]

确认性审议增量以共享 initial proposals 后分支运行的 C6 − C5 为准。每个 C6 run 仍应从其 initial proposals 保存 pre-debate majority 作为过程诊断指标，但该 majority 不替代完整的 C5 对照。

#### Candidate recall

闭集任务：正确答案或支持正确答案的原始 claim 是否进入 normalize candidates。  
开放任务：以 task-specific rubric claim 或人工标注的关键 claims 计算；若无法可靠标注，只做案例分析，不给出伪精确总体数字。

#### Dissent survival

少数但正确/重要的原始 claim 是否经过 revise、normalize、vote 和 compose 保留到最终输出。

### 11.4 多目标结果

除 Pareto 图外，报告：

\[
ICER=\frac{Q_A-Q_B}{Cost_A-Cost_B}
\]

即每增加一单位质量需要的增量美元成本。若分母接近 0 或条件被支配，不强行解释该比值。

---

## 12. 统计分析计划

### 12.1 分析原则

- task 是主要抽样单元；
- 所有主要比较采用同题 paired design；
- 同一 task 的 repetitions 不视为独立 task；
- 报告 effect size、95% CI 与完整分布，不只报告 p-value；
- 不把跨 benchmark 的原始分数直接平均，先在任务块内标准化或分别报告。

### 12.2 Primary analysis

对于二元 correctness：

- paired difference 与 cluster bootstrap CI；
- McNemar test 作为简单配对检验；
- 分层 logistic mixed-effects model 检验 protocol × task block、diversity × task difficulty。

对于连续 scorer：

- task-cluster bootstrap；
- mixed-effects/分层回归，task block 与 panel 作为层级；
- 必要时使用稳健或秩方法处理重尾分布。

### 12.3 Diversity analysis

预测 panel gain：

\[
Gain_{S,t}=\beta_0+\beta_1 Ability_S+\beta_2 Cost_S+\beta_3 ErrorCorr_S+\beta_4 OracleCoverage_S+\beta_5 TaskDifficulty_t+u_t+\epsilon
\]

模型家族/跨厂商变量放在错误相关性之后加入，比较其增量解释力。避免将同一 screening 数据既用于选择 panel 又用于无偏评估：panel selection 使用 screening split，最终预测检验使用 held-out confirmatory tasks。

### 12.4 多重比较

- H1–H3 构成确认性检验 family，使用预注册的 family-wise correction；
- RQ1 的嵌套增量全部报告 effect size 与置信区间，但除非在预注册中明确升级，不将其中每个对照分别作为新的显著性主张；
- secondary contrasts 使用 Holm 或 FDR；
- exploratory process metrics 明确标为探索性；
- 不根据显著性把 secondary 结果改写成 primary。

### 12.5 样本量与重复次数

Screening/pilot：每个基础 condition 2 次独立重复，用于估计方差和失败率。  
Confirmatory：主要 conditions 默认至少 3 次，finalist 可增至 5 次，但最终次数由 pilot power simulation 和预算确定。

`D8 — 最小有意义效应（决策流程已确认）`  
WP1 与 WP5 在 Stage 0 pilot 后，根据 task-level variance、评分尺度和实际调用成本提出 \(\delta_Q\) 与 ICER 判定规则，团队在 G2 批准。不要把“统计显著但实际只有极小提升”视为成功；D8 未批准前不得启动 confirmatory。

---

## 13. 成本与延迟分析

### 13.1 两条比较轨道

**Structural track：** 同 panel、同任务、统一每次调用上限，允许协议产生不同总调用量；测量每个阶段自然增加的成本与收益。

**Budget-matched track：** 为每个 task 设置相同的总美元或 token envelope；baseline 可用相同预算增加采样或使用更强单模型。

Structural track 用于解释阶段机制；Budget-matched track 用于回答“用户应该买什么”。

### 13.2 成本口径

优先级：

1. provider 响应返回的实际 cost；
2. 固定日期的官方价格 × 实际 usage；
3. 无法确定时标为 unknown，不伪造。

每张成本图必须说明是否含：

- retry/repair；
- reasoning tokens；
- search/tool fee；
- failed calls；
- judge/scorer 成本。

评测成本与被评系统推理成本分开报告。

### 13.3 延迟口径

- total wall-clock 是主指标；
- fan-out 并行阶段同时报告最大单调用 latency；
- 排队/限流可能影响 wall-clock，因此 conditions 交错运行并记录 provider/time；
- 不把串行调用数直接当作延迟估计。

---

## 14. 数据质量、有效性与偏差控制

### 14.1 内部有效性

| 风险 | 控制 |
|---|---|
| 模型能力与多样性混杂 | ability/cost matching、协变量与 held-out tasks |
| coordinator 过强 | synthesis、coordinator-only、role sensitivity |
| 输出长度影响 scorer | 记录长度、必要时做长度控制/协变量 |
| 顺序/身份偏差 | 匿名、随机排列、顺序反转 |
| prompt 不等价 | prompt versioning、统一意图与模板审查 |
| 重试掩盖失败 | ITT、固定 retry policy、失败调用计费 |

### 14.2 外部有效性

- 模型池不是所有模型的代表；
- 闭源模型可能静默更新；
- benchmark 任务不同于真实长时工作；
- tools-off 主实验不代表联网 agent；
- 英文主实验不能自动外推到中文；
- 开放研究任务和外部产品对照只提供外部效度，不应覆盖闭集机制结果。

### 14.3 Benchmark 污染

- 固定最新可用 release 与访问日期；
- tools-on 阻断 rubric/answer 域；
- 保存 search query/URL trace；
- 优先使用持续更新、可自动评分任务；
- 不把“Google-proof”视为绝对无污染保证。

### 14.4 Judge 偏差

Stage 1–3 不依赖 LLM judge。Stage 4 若包含开放任务或必须使用 LLM judge 的外部比较，则必须：

- 至少三个不同家族 judge；
- identity blind；
- position randomization/reversal；
- criterion-level rubric；
- 先做人评 calibration pilot；
- 报告 judge 间一致性和绝对分数敏感性。

### 14.5 模型漂移

- 保存 snapshot/route 和响应 metadata；
- 同一 confirmatory batch 尽量短时间完成；
- 每日运行固定 anchor tasks；
- anchor score 或响应行为突变时暂停 batch；
- 不把漂移前后数据无说明合并。

---

## 15. 研究基础设施要求

### 15.1 `ExperimentManifest`

必须支持从一个 manifest 复现完整 batch，并包括第 10.1 节字段。

### 15.2 `CallLedger`

每个 inner call 至少保存：

- run/task/condition/repetition id；
- phase、role、model、provider；
- timestamps 与 latency；
- prompt/version/hash；
- usage/cost；
- response artifact/hash；
- retry/repair attempt；
- success/error/filter；
- parent call 与 candidate/claim ids。

### 15.3 `mmd.trace.v2`

统一 main 与 LiteLLM 分支：

- proposals、critiques、revisions；
- normalize mappings；
- ballots/classifications；
- final claim coverage；
- call ledger references；
- cost、timing、quorum、failures；
- protocol/prompt/model versions。

### 15.4 Parity requirement

`D11 — 主实验 backend（已确认）`  
主实验优先使用 `litellm-integration`。若 backend parity gate 未通过，Stage 1–3 必须统一使用一个通过验证的 backend，不混合两个实现的数据。

`G0 — Backend parity gate`  
在真实 benchmark 前，main 与 LiteLLM 对同一 deterministic mock fixture 必须产生语义等价的：

- phase path；
- candidate/source mappings；
- ballots/classifications；
- failure/quorum semantics；
- usage aggregation。

如果不能通过，正式实验只选择一个 backend，另一分支不混入数据。

### 15.5 Artifact 与合规

`D12 — 公开资产范围（已委托）`  
由 WP4 Dataset/scorer/quality 团队负责制定逐 benchmark、逐 artifact 的发布矩阵，WP6 复核。方案须在 G2 前说明题目、模型输出、trace、manifest、汇总结果和统计代码分别能否公开、需要何种脱敏，以及适用的 dataset license 与 provider 条款。未完成该审查的资产不得承诺公开。

- 原始 benchmark 题目是否可公开由 license 决定；
- API secrets 永不进入 trace；
- 可能含个人/敏感信息的开放 prompt 不进入公开数据；
- 发布 sanitized manifest、condition-level result、统计代码和必要的 claim trace；
- 对无法公开的原始输出提供 hash、schema 和可复跑说明。

---

## 16. 阶段门槛

### G0：Infrastructure Gate

- manifest 可重复启动/恢复；
- ledger 覆盖所有 inner calls；
- 成本总和可从 ledger 重建；
- 固定 mock parity 通过；
- 失败、retry、repair 都可见。

### G1：20-task Dry Run Gate

- 所有核心 conditions 均可完成；
- scorer 可重现；
- 无 system prompt/答案解析明显错误；
- 成本与延迟没有超出硬上限；
- 失败没有被静默丢弃。

### G2：Screening/Pilot Gate

- 模型池有足够能力差异和错误互补性；
- 可以找到至少一组 ability/cost 大致匹配的高/低多样性 panel；
- 估计 task-level variance、失败率和平均成本；
- WP1/WP5 提交、团队批准 D8 最小有意义效应、ICER 规则与 D9 confirmatory 预算上限；
- 冻结 primary contrasts、任务和统计计划。
- WP4 提交、WP6 复核 D12 公开资产与合规矩阵。

### G3：Data Lock Gate

- confirmatory manifest 不再改动；
- 排除项由盲于 condition 的流程决定；
- 结果表由独立成员从 raw ledger 重建；
- 主分析脚本在揭盲前固定。

### G4：Claim Gate

- 论文主张不超过第 2.3 节允许层级；
- 负结果、失败率和 unknown cost 不隐藏；
- 至少一次独立复跑；
- 所有主图能追溯到 immutable artifact。

---

## 17. 可量化工作包与动态责任配置

本研究不预设团队人数。每个 work package 在启动时指定一名 accountable owner、零至多名 executor 和至少一名 reviewer；同一成员可以负责多个不冲突的工作包，也可以根据实际容量拆分执行任务。工作量以可验收产物和实验单元计量，不以固定人头或工期计量。

### 17.1 工作量符号

| 符号 | 含义 | 当前约束 |
|---|---|---|
| \(M\) | screening 模型数 | 6–8 |
| \(T_s\) | screening tasks | 工程起点 120 |
| \(R_s\) | 每模型 screening repetitions | 2 |
| \(T_c\) | confirmatory tasks | G2 power simulation 决定 |
| \(R_c\) | confirmatory repetitions | 默认至少 3，G2 决定最终值 |
| \(K_c\) | 锁定的 condition × panel cells | G2 manifest 决定 |

因此，基础 screening 工作量为 \(N_s=M\times T_s\times R_s\)，按当前范围约为 1,440–1,920 个 solo runs；confirmatory 工作量为 \(N_c=T_c\times R_c\times K_c\) 个 condition-runs。每个 condition-run 的 inner-call、token、成本和延迟乘数由 dry run 实测，不用静态调用数替代。

### 17.2 Work packages

| WP | 责任范围 | 量化待完成内容 | 完成标准 | 主要依赖 |
|---|---|---|---|---|
| WP1 | Protocol/preregistration | 1 份 protocol、1 份 analysis plan；覆盖 RQ1–RQ7、H1–H3、13 项 D 决策及全部 primary estimands | D8/D9 获批；RQ/H、outcome、exclusion、multiplicity 一一映射 | v0.3 study plan、Stage 0 pilot |
| WP2 | Runner/manifest/ledger/trace | 1 套 manifest schema、1 套 CallLedger、1 套 trace v2、1 套 resume/export pipeline、至少 1 个 deterministic parity fixture | C0–C6 均可从 manifest 启动；100% inner calls 可追踪；成本可从 ledger 重建 | protocol fields、backend contract |
| WP3 | Provider/backend/cost | \(M=6\text{–}8\) 个冻结模型的兼容矩阵；每个模型至少验证 structured output、usage、cost、timeout/retry 和 route metadata | 所有入选模型通过调用契约；dry-run cost reconstruction 无未解释差额；backend gate 通过 | WP2 schema、可用 API access |
| WP4 | Dataset/scorer/quality | 至少 2 个 primary adapters（R、K）、1 个 secondary adapter（I）；20-task dry-run set、约 120-task screening frame、scorer tests、data card、D12 发布矩阵 | scorer 可重复；sampling frame 互斥且 hash 固定；license/provider 条款逐项记录 | WP1 inclusion rules、dataset access |
| WP5 | Screening/diversity/panel lock | 验收 WP7 产生的 \(N_s\) 个 screening run 终态；1 份 ability/cost/error-correlation matrix；锁定 P-diverse、P-family 及各自 matched P-homo reference；1 份 power/cost simulation | screening 覆盖率与缺失规则通过；matching balance 达标或撤回 H1；panel selection 只使用 screening split；D8/D9 提案完成 | WP3 model matrix、WP4 screening frame、WP7 screening batches |
| WP6 | Independent QA/reproduction/release | 从 raw ledger 独立重建 100% primary tables；至少 1 个锁定 batch 独立复跑；人工 trace audit 基线为 \(\max(30,5\%\times N_c)\) 个随机 runs；1 份 QA report 和 release checklist | G3/G4 通过；所有主图可追溯；差异有书面处置 | WP2 artifacts、WP7 batches、WP8 analysis |
| WP7 | Experiment execution | 完成 20-task × C0–C6 dry run；执行全部 \(N_s\) screening 与 \(N_c\) confirmatory units；维护 immutable batch registry 和 drift anchors | 计划单元均有 success/failure 终态；无静默缺失；所有 rerun 有原因码 | WP2–WP5、G0–G2 |
| WP8 | Statistical analysis/paper | RQ1 的 5 个预定义增量、H1 difference-in-differences、H2 moderation、H3 paired transition；质量/成本/延迟/Pareto/失败分析；1 份主稿和 artifact index | 主分析脚本在揭盲前冻结；结果同时含 effect size、CI、负结果和敏感性分析 | G2 analysis plan、WP7 data、WP6 rebuild |

Stage 4 的角色消融、开放研究和外部系统比较单独建立 optional backlog，不计入 Paper A 最小完成量。

### 17.3 动态分工规则

- 每个 WP 必须有 accountable owner；executor 数量按当前容量增减。
- reviewer 不得审核自己生成的同一交付物；一个人团队无法满足的独立复核必须在 G3/G4 前补充外部 reviewer。
- 运行主结果的人不能单独决定题目排除、失败重分类或异常 batch 删除。
- WP1/WP5、WP4/WP6 的既定决策关系保持不变，但不要求由不同的固定编号成员长期承担。
- 分工表在每个 gate 重新填写 owner、executor、reviewer 和剩余工作单元；人员变化不改变已经锁定的 protocol、manifest 或统计计划。
- 增加成员优先并行化 adapters、provider validation、独立 batch 和 QA；不得通过跳过 gate 或减少独立复核来压缩周期。

---

## 18. 依赖式里程碑与容量规划

研究周期由 gate、剩余工作单元和团队实际吞吐量决定，不在研究方案中预设周数。

### 18.1 关键路径

| Milestone | 必须完成的量化内容 | Exit/Gate | 可并行工作 |
|---|---|---|---|
| M0：Decision lock | D1–D13 均已确认或指定 owner/gate | v0.3 | WP1 protocol skeleton、WP2/WP4 design |
| M1：Research-ready infrastructure | WP2 五类基础组件；WP3 模型契约；WP4 scorer skeleton | G0 | provider validation、dataset adapters、analysis skeleton |
| M2：Dry run | 20 tasks × C0–C6；全部 run 有终态和 ledger | G1 | D12 合规矩阵、screening batch preparation |
| M3：Screening complete | \(N_s=1,440\text{–}1,920\) solo runs；ability/cost/error matrix | panel candidate set | analysis code、confirmatory manifest template |
| M4：Pilot/design lock | matched panels、\(\delta_Q\)、ICER、\(T_c\)、\(R_c\)、\(K_c\)、预算和 preregistration 全部锁定 | G2 | batch scheduling、QA sampling plan |
| M5：Confirmatory complete | \(N_c=T_c\times R_c\times K_c\) condition-runs 全部达到终态 | raw data lock | 独立 batch audit、Stage 4 go/no-go preparation |
| M6：Independent rebuild | 100% primary tables 重建；人工 audit 与至少 1 个 batch 独立复跑完成 | G3 | paper methods、data card、artifact packaging |
| M7：Claim/release | 主稿、QA report、artifact index、release checklist 完成 | G4 | 可选 Stage 4 |

关键路径为 M0→M1→M2→M3→M4→M5→M6→M7。Stage 4 不在关键路径上，不得阻塞 Paper A 的主结果与投稿。

### 18.2 根据团队规模动态估算周期

每次 gate 后更新以下容量表，而不是使用固定周计划：

| Workstream | 剩余单位 | 实测有效吞吐量 | 预计完成时间 |
|---|---:|---:|---:|
| Provider validation | 未通过验证的 models | validated models / 工作日 | 剩余 models ÷ 吞吐量 |
| Dataset/scorer | 未通过验收的 adapters/tasks | validated adapters 或 tasks / 工作日 | 剩余单位 ÷ 吞吐量 |
| Screening | 剩余 solo runs | valid runs / 工作日 | 剩余 runs ÷ 吞吐量 |
| Confirmatory | 剩余 condition-runs | valid condition-runs / 工作日 | 剩余 runs ÷ 吞吐量 |
| QA | 剩余 batches/audit runs | validated units / 工作日 | 剩余单位 ÷ 吞吐量 |

总体完成时间取关键路径上各串行 milestone 的预计时间之和；同一 milestone 内取并行 workstream 中最慢者。吞吐量只使用 dry run 或已完成 batch 的有效结果估计，并计入失败、限流、人工审查和返工，不能用理论 API 并发上限代替。

---

## 19. 预算框架

### 19.1 不在当前版本填写固定总额

真实预算取决于模型池、reasoning tokens、输出长度、失败和 provider 价格。当前只定义预算过程：

1. Dry run 得到单 condition 的实际成本区间；
2. Screening 得到每模型每任务成本分布；
3. Pilot 根据效应方差模拟 confirmatory 条件数和重复数；
4. 预留 retry/failure、judge 和独立复跑预算；
5. 所有 batch 有全局和 per-run hard cap。

### 19.2 预算模板

可从以下比例开始，再由 pilot 修改：

- 10% infrastructure/dry run；
- 15% screening/pilot；
- 50% Stage 1–3 confirmatory；
- 10% robustness/role ablation；
- 10% Stage 4 外部效度、judge 与 human calibration；
- 5% independent rerun。

`D9 — 总预算上限（决策流程已确认）`  
WP1 与 WP5 在 Stage 0 screening/pilot 后，根据实际 usage、失败率、效应方差和所需重复次数提出 confirmatory 总预算及 contingency，团队在 G2 批准。没有已批准的预算上限，不启动 confirmatory。

---

## 20. 团队逐项决策清单

| ID | 决策 | 推荐默认 | 状态 |
|---|---|---|---|
| D1 | 标题与主叙事 | “Where do multi-model gains come from?” | ☑ 已确认 |
| D2 | Paper A Stage 1–3 是否 tools off | 是 | ☑ 已确认 |
| D3 | Primary task blocks | Reasoning + Knowledge；Instruction secondary | ☑ 已确认 |
| D4 | 模型池冻结规则 | Stage 0 screening 前冻结；替换须重跑受影响 screening | ☑ 已确认 |
| D5 | 两个 primary confirmatory effects | diversity difference-in-differences、C6−C5 | ☑ 已确认 |
| D6 | 角色消融是否进入主实验 | 否，数据锁定后条件性扩展 | ☑ 已确认 |
| D7 | 是否运行外部系统对照 | 可选 Stage 4；非投稿必要条件 | ☑ 已确认 |
| D8 | 最小有意义效应与 ICER | WP1/WP5 提案，G2 团队批准 | ↪ 流程已确认 |
| D9 | confirmatory 总预算上限 | WP1/WP5 提案，G2 团队批准 | ↪ 流程已确认 |
| D10 | panel size | 主实验固定 N=3 | ☑ 已确认 |
| D11 | 主实验 backend | LiteLLM 优先；parity 失败则单 backend | ☑ 已确认 |
| D12 | 公开资产范围 | WP4 制定发布矩阵，WP6 复核 | ↪ 已委托，G2 前完成 |
| D13 | 目标 venue/截稿节奏 | Stage 0 pilot 后决定 | ↪ 流程已确认 |

---

## 21. 可能结果与对应论文

| 主要结果 | 论文中心结论 | 后续方向 |
|---|---|---|
| 异构 panel + 结构化审议形成新 Pareto 前沿 | 有效多样性和审议都贡献 | Paper B 学习触发与选模 |
| 异构 panel 有益、结构化审议不优于 vote | diversity 有价值，discussion 不划算 | 轻量 vote/quick router |
| 结构化审议只在高分歧/知识任务有益 | 审议是条件性 test-time compute | Paper B selective deliberation |
| 平均质量无增益但 disagreement 预测错误 | trace 的价值在风险识别 | Paper C calibration/escalation |
| 所有收益均由 coordinator/额外 token 解释 | 当前实现不支持审议机制具有独立优势 | 将 MMD 定位为审计与实验工具 |
| 结果不稳定且依赖模型版本 | 组合规律高度非平稳 | 研究 model drift/online selection |

失败标准不是“没有显著提升”，而是无法区分原因、无法复现或隐藏成本。清晰的负结果仍可形成有效论文。

---

## 22. 关键来源

- Du et al., *Improving Factuality and Reasoning in Language Models through Multiagent Debate*, ICML 2024: https://proceedings.mlr.press/v235/du24e.html
- Choi et al., *Debate or Vote: Which Yields Better Decisions in Multi-Agent Large Language Models?*, NeurIPS 2025: https://proceedings.neurips.cc/paper_files/paper/2025/file/934252acd87f254d5d4672fbde283bd2-Paper-Conference.pdf
- Kaesberg et al., *Voting or Consensus? Decision-Making in Multi-Agent Debate*, Findings ACL 2025: https://aclanthology.org/2025.findings-acl.606/
- Jiang et al., *LLM-Blender*, ACL 2023: https://aclanthology.org/2023.acl-long.792/
- Wang et al., *Mixture-of-Agents Enhances Large Language Model Capabilities*, 2024: https://arxiv.org/abs/2406.04692
- Fan et al., *iMAD*, AAAI 2026: https://ojs.aaai.org/index.php/AAAI/article/view/40181
- Zhu et al., *Demystifying Multi-Agent Debate: The Role of Confidence and Diversity*, Findings ACL 2026: https://aclanthology.org/2026.findings-acl.1694/
- DRACO benchmark, 2026: https://arxiv.org/abs/2602.11685
- 本研究的完整来源台账：`research/mmd-research-plan/sources.md`

---

## 23. v0.4 状态与下一步

D1、D2、D3、D4、D5、D6、D7、D10 和 D11 已确认；D8、D9、D12 和 D13 已明确 owner、gate 与决策时点。v0.4 在此基础上取消固定团队人数和固定周计划，改用可量化 work packages、gate 依赖和实测吞吐量进行动态资源规划。

进入可提交的 preregistration draft 前仍须：

- 增加具体数据集版本、互斥 sampling frame 与 dataset hash；
- 冻结候选模型、provider route 和 price snapshot；
- 由 WP1/WP5 完成 D8/D9，并记录 G2 批准结果；
- 由 WP4 完成、WP6 复核 D12 发布矩阵；
- 增加实验条件 × task × panel × repetition 的调用量和预算估算；
- 将本方案转换为正式 protocol 与 analysis plan；
- 拆解 WP1–WP8 的代码 issue/backlog；
- 在 Stage 0 pilot 后确认 D13 venue 与截稿节奏。
