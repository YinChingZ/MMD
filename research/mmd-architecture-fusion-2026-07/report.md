# MMD 集中式与分布式协调架构融合方案

日期：2026-07-20  
状态：最终修订稿（v2）；尚无 MMD 自身双架构实测结果

实施注记：核心 `mmd.v3` 路径已在 commit `da304a3` 落地；本文定义的完整
CN/DN 共享 branch root、2×2 runner、Standard-D deterministic-render/fidelity
gate 和正式 main/LiteLLM parity 仍是后续研究基础设施目标。

## Executive summary

最合适的融合不是把 coordinator 从 MMD 中移除，也不是让 Quick、Standard、Planning 全部产生两套排列组合，而是把 coordinator 明确保留为一种主流的集中式认知治理，并只在最适合做严格对照的 Standard 中加入分布式治理。

推荐产品与研究架构：

| Mode | Governance | 推荐状态 | 原因 |
|---|---|---|---|
| Quick | centralized only | 产品唯一路径 | 产品 N=2 无稳定多数；需要便宜的 tie-break 和自然最终答案 |
| Standard | centralized | 兼容默认、Paper A 主路径 | 当前完整 MMD；代表主流 coordinator 架构 |
| Standard | distributed/peer-governed | 新增第二路径 | 最适合从同一 post-revision claims 分支，研究单点治理与群体治理 |
| Planning | coordinator-locked | 唯一路径 | 长文需要 outline、跨主题协调和一次全局生成式融合；用 Normalize-to-Final lineage contract 控制权力 |

Paper A 的 C0–C6 不应重写。C4/C5/C6 继续使用集中式 MMD，保持现有 sampling、vote 和 deliberation estimands；但 C4 必须明确为研究协议 `Traceable-Quick-C@N3`，不能与产品 N=2 Quick 混称。新增的 Standard-D 作为预先声明的 secondary governance branch，并用内部 2×2 artifact branching 估计 Normalize 和 Compose 治理的条件性协议效应。

这一选择同时承认两类证据：集中式 ranking/fusion/orchestration 在 [LLM-Blender（ACL 2023）](https://aclanthology.org/2023.acl-long.792/)、[MoA（2024）](https://arxiv.org/abs/2406.04692)、[Magentic-One（Microsoft Research 2024）](https://www.microsoft.com/en-us/research/publication/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/) 等系统中是成熟范式；[Free-MAD（Findings ACL 2026）](https://aclanthology.org/2026.findings-acl.1600/)、[EoT（2023）](https://arxiv.org/abs/2312.01823)、[MacNet（2024）](https://arxiv.org/abs/2406.07155) 和 [topology propagation research（2025）](https://arxiv.org/abs/2505.23352) 又表明非集中或不同通信拓扑可能改变从众、错误传播或串行成本。外部文献支持“值得对照”，不支持在没有 MMD 实测前宣布任一端普遍优越。

## 1. 为什么不是统一替换或全模式双轨

### 1.1 Coordinator 应保留

MMD 当前的 coordinator 有两个认知角色：Normalize 形成候选本体，Compose 形成最终文字。它既可能带来遗漏和重写，也可能提供语义压缩、冲突解释和可用的自然语言结果。

中央 aggregator 并非 MMD 的偶然遗留：[LLM-Blender](https://aclanthology.org/2023.acl-long.792/) 使用 PairRanker 和 GenFuser，[MoA](https://arxiv.org/abs/2406.04692) 依赖分层聚合，[Magentic-One](https://www.microsoft.com/en-us/research/publication/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/) 由 lead Orchestrator 规划和纠错。因此 coordinator 是 Paper A 应研究的主流机制，而不是应从研究对象中预先排除的缺陷。

### 1.2 全模式双轨会产生错误复杂度

- Quick 的目标是快速；增加治理选择会让“快”同时代表不同 candidate 和 final-answer 语义。
- Planning 有 Outline、T 个 topic、每 topic 的 Normalize/Vote/Compose；再乘集中/分布两套会快速放大运行与分析单元。
- Paper A 的主效应是 diversity 和 deliberation；如果每个条件再乘 governance，研究范围会从机制分解扩张成完整拓扑论文。
- 产品用户只需要少数清晰选择；研究 manifest 才需要细粒度因子。

所以应把产品 mode 与研究 factor 分开。

## 2. 推荐协议

### 2.1 Quick：产品只保留 centralized classic

```text
2 × Propose
  → 1 × Coordinator Normalize
  → code derives source-coverage status
  → 1 × Coordinator Compose
```

保留理由：

1. 两个 peers 出现分歧时没有多数决；单一 coordinator 提供明确 tie-break 和最终表达。
2. distributed Quick 即使也是四次调用，也要解决两份 alignment 的冲突和无 composer 的最终答案问题。
3. Quick 是现有产品基线；维持它有利于纵向比较。

必要修复：

- 产品运行时真正强制 N=2；当前 budget 写了 2，但 API 缺省会选全部 registry models。
- coordinator identity 必须显式记录。
- Quick 没有显式 vote，不应把 coverage-derived 状态与 ballot-derived consensus 混为同一证据。至少在 trace 中记录 `classification_basis: source_coverage`；更理想的用户标签是 `corroborated_all`、`single_source`、`conflicting`、`alignment_uncertain`。
- 不建议把 Normalize 和 Compose 合并为一次调用；那会把候选本体与最终写作重新压进不可拆分的单次判断。

Paper A 是例外但不是第二种产品 Quick：主实验已固定 panel size N=3，C4/C5 又必须共享相同 proposals，因此 C4 应作为 `Traceable-Quick-C@N3` 由实验 runner 显式运行。它沿用 centralized Normalize/Compose，但使用 N=3 的 source-coverage 状态；不得调用产品 Quick 的 N=2 默认，也不得把二者的自然成本或标签直接合并报告。实验 runner 应有受 manifest 约束的 panel-size override，普通 API 不开放该 override。

### 2.2 Standard-C：保留当前完整路径

```text
Propose_N → Critique_N → Revise_N
→ Normalize_C → Vote_N → deterministic classify → Compose_C
```

它继续承担三个角色：

- 产品默认和兼容路径；
- 主流 coordinator 架构代表；
- Paper A C6 的主实验实现。

Normalize 和 Compose 必须继续保存独立 trace，不能因为新增另一架构而合并。

### 2.3 Standard-D：新增 peer-governed 路径

```text
Propose_N → Critique_N → Revise_N
→ Align_N
→ deterministic complete-link clustering / Claim Ledger
→ Vote_N → deterministic classify/decision/render
```

建议的 Align 输出不是自由生成的最终候选，而是对 raw claim IDs 的结构化判断：

- equivalent / distinct / conflict / uncertain；
- 每个 equivalence group 的 preferred source variant；
- 明确 cannot-link；
- aligner identity 和 confidence。

Host 根据 alignments 建立 pair-support matrix，以保守 complete-link 规则聚类。每个 raw claim 必须恰好进入一个 cluster；证据不足时保持分离，不通过传递闭包强行合并。

Standard-D 的权威结果是 ledger、ballots、classification 和 deterministic canonical output。可以额外生成自然语言 polish，但必须：

- 标明 non-authoritative；
- 每段携带 candidate IDs；
- 不能影响 Paper A scorer；
- 通过 fidelity checker；
- 失败时不影响 canonical result。

在开放式 presentation quality 完成人评前，Standard-D 应标为 experimental/research path，而不是立即取代默认 Standard。对 R/K 闭集任务可以先正式评测；对一般产品问答同时显示 canonical ledger 和可选 polish，避免把未经验证的 deterministic prose 当作成熟体验。

产品不应把它描述为“没有 orchestrator”，因为 host 仍负责编排；准确名称是 `peer-governed` 或 `distributed epistemic governance`。

### 2.4 Planning：Coordinator-locked + Global Compose

Planning 应彻底转向层级式 coordinator 架构。当前每个 topic 独立 `SectionCompose`、最后由代码拼接 TLDR 的实现只能得到并列汇编，不能解决跨主题依赖、约束冲突和整体取舍。推荐路径是：

```text
Outline_C
→ add deterministic cross-cutting-risk topic
→ parallel topics:
   Propose_N → Critique_N → Revise_N
   → Normalize_C → Vote_N → classify
→ GlobalCompose_C
→ one integrated PlanningFinalAnswer
```

Topic artifacts 仍完整保存在 trace，但不再作为用户可见的若干独立 final sections。最终 coordinator 一次性读取所有 topic 的规范化 candidates、classification、disputes 和必要 position changes，生成一个统一 `final_answer`。答案可以为了可读性使用标题和段落，但必须由同一次全局综合形成，而不是拼接互相不可见的 section outputs。

“强制 Normalize 到最终答案”应定义为可验证的 lineage contract：

- 产品默认在一次 run 内锁定同一 coordinator role/config；
- GlobalCompose 接收带 `topic_id + candidate_id + classification + text` 的结构化对象；
- 每个实质输出 span 保存 `source_candidate_ids`；
- strong consensus 未采用必须给 omission reason；
- disputed 不得被写成无条件结论；
- 跨主题新推论必须标记为 `coordinator_synthesis` 并列出 `derived_from_candidate_ids`，不能伪装成 panel consensus；
- final artifact 保存 topic→candidate→output-span lineage。

默认直接从压缩后的 candidate ledgers 做一次 GlobalCompose，不向最后调用重复发送原始 proposals/critiques。若仍超过 context budget，可由 coordinator 生成内部 topic briefs 再做全局综合；briefs 只是压缩 artifacts，不是用户最终答案。

调用数由当前约 `1+T(4N+2)` 变为约 `2+T(4N+1)`：移除 T 次 section compose，增加一次 global compose。总调用数通常更低，但最后一个大上下文调用可能更慢，必须实测。GlobalCompose 是显式单点；失败时应保留所有 topic ledgers，允许固定次数重试，并提供结构化 fallback，而不是丢弃整个 run。

Outline 漏项仍需补强：真正被漏掉的主题可能没有后续容器，因此代码应固定加入 `cross_cutting_risks_and_omissions` topic。Planning 暂不提供 distributed governance；若 Standard-D 证明信息保留更好，后续优先研究 peer audit，而不是复制完整分布式 Planning。

同一 coordinator 贯穿 Outline、Normalize 和 GlobalCompose 可能提高整体一致性，也可能让同一遗漏相关地贯穿全程。当前没有 MMD 自身数据能判断净效应；产品默认可以锁定同一 identity，但 Stage 4 应记录 `same coordinator` 与 `role-swapped coordinator` 的敏感性条件，且不能把文风一致当作正确性证据。

## 3. 产品接口与内部协议因子

建议保持现有三种 mode：

```ts
mode: "quick" | "standard" | "planning"
governance?: "centralized" | "distributed"
```

验证规则：

- 产品 Quick：只接受 centralized，缺省即 centralized；严格 N=2。Paper A runner 通过独立 experiment manifest 显式运行 N=3，不走普通产品默认。
- Standard：接受 centralized/distributed；兼容缺省为 centralized。
- Planning：只接受 centralized；必须有 coordinator。
- 不允许不支持的组合被静默忽略。

研究 manifest 使用更细的正交字段：

```text
interaction_protocol: quick | vote | deliberation | planning
normalization_governance: coordinator | peer_alignment
render_governance: coordinator | deterministic
coordinator_model_id: optional/required-by-condition
artifact_parent_id
candidate_set_id
alignment_algorithm_version
decision_rule_version
renderer_version
```

这样产品只显示两个 Standard 选择，而研究可以运行内部 2×2，不把产品命名当作统计变量。Standard-D 在完成 presentation/fidelity gate 前只作为 experimental 选项。

## 4. Paper A 如何融合而不破坏原计划

### 4.1 C0–C6 保持不变

- C4：`Traceable-Quick-C@N3`，即 centralized Quick 协议的 N=3 研究实例，不是产品 N=2 Quick；
- C5：现有 centralized Traceable-Vote；
- C6：现有 centralized Standard。

因此：

- `C5−C4` 在两者共享 N=3 proposals、同一 central Normalize/Compose 和同一失败规则时，仍是 coordinator 架构内显式 ballot 的增量；
- `C6−C5` 仍是 coordinator 架构内 critique/revise 的增量；
- H1–H3、D5 和历史比较不需要重写。

C4 的无投票状态必须按 source coverage 单独定义；不能继续把覆盖产生的隐式 approve 与 C5 的真实 ballots 当作同一种证据。否则 `C5−C4` 会把“有无投票”与“标签含义不同”混在一起。研究输出可映射到共同的最终答案 scorer，但过程标签必须保留 `classification_basis`。

### 4.2 新增预先声明的 Standard governance bridge

同一 `task × panel × repetition` 只运行一次：

```text
Propose → Critique → Revise → immutable postRevisionClaims
                                  ├─ CN → Vote_CN ─┬─ CR
                                  │               └─ DR
                                  └─ DN → Vote_DN ─┬─ CR
                                                  └─ DR
```

四个内部 cell：

| ID | Candidate governance | Final render | 估计用途 |
|---|---|---|---|
| SG1 | CN | CR | 当前 C6；集中式端点 |
| SG2 | CN | DR | Compose effect under central candidates |
| SG3 | DN | CR | Normalize governance effect under common composer |
| SG4 | DN | DR | 分布式端点 |

关键的条件性协议 contrasts：

- 完整架构：`Q(SG4) − Q(SG1)`；
- Normalize governance under deterministic render：`Q(SG4) − Q(SG2)`；
- Normalize governance under coordinator render：`Q(SG3) − Q(SG1)`；
- Render effect under CN：`Q(SG1) − Q(SG2)`；
- Render effect under DN：`Q(SG3) − Q(SG4)`；
- interaction：两个 render effect 之差。

这不是把最终增益严格加法分解成两个天然独立成分：CN 与 DN 会产生不同数量和文本的 candidates，随后 ballots 也随 candidate set 改变。上述 contrasts 识别的是在明确定义 pipeline 下的条件性治理效应；论文不得把它们表述为与输入无关的纯 `G_normalize` 或 `G_compose` 常数。

这组分析应预先列为 RQ4 secondary，而不是看到 C6 结果后才触发。样本量和是否覆盖全部 confirmatory tasks 在 G2 根据 pilot 方差和预算决定；如果只跑子集，必须在结果揭盲前固定分层规则。

### 4.3 调用成本

N=3、无 repair 时：

- 当前 Standard-C：14 calls；
- Standard-D：15 calls；
- 两个端点若独立运行：29 calls；
- 共享 post-revision artifact 的两个端点：20 calls；
- 完整 2×2：21 calls。

2×2 相对端点 paired 只增加一次 `DN+CR` compose，因而比新增四个完整 runs 合理得多。不过 Align 会向 N 个模型重复发送 claims，实际 input-token 成本必须由 pilot 测量，不能由调用数替代。

### 4.4 评价指标

保留现有 task quality、cost、latency、wrong→correct、correct→wrong，并增加：

- raw-claim coverage invariant；
- false merge / false split；
- minority claim distinguishability；
- alignment disagreement 与 order stability；
- candidate-set size/duplication；
- candidate→vote→final lineage coverage；
- composer/polish hallucination 与 dispute laundering；
- central single-point failure 与 distributed partial-quorum degradation。

SG1/SG3 的 prose 可用相同 scorer；SG2/SG4 在 R/K 闭集任务上使用预注册的 deterministic answer selector。开放任务不应把结构化 ledger 和自然语言文档塞进一个总分，应分开测 semantic coverage 和 presentation quality。

## 5. Trace 与 failure semantics

建议将双治理 artifact 定义为 `mmd.trace.v3`：

- immutable raw/post-revision claims；
- coordinator normalize mapping；
- peer AlignmentSets、pair-support matrix、cannot-links；
- deterministic cluster merge/reject log；
- CN/DN candidate crosswalk；
- 每个 candidate set 独立 ballots/classifications；
- CR/DR outputs 与 source candidate IDs；
- classification basis；
- phase/call ledger、quorum、partial、cost 和 latency；
- protocol、prompt、algorithm、threshold、renderer versions。

Failure semantics：

- CN 失败：central branch failed，不影响 DN branch；
- CR 失败：对应 prose cell failed，CN/DN ledger 仍是有效 artifact；
- Align 未达 quorum：DN branch failed；达到 partial quorum 时，只允许保守拆分并标记 uncertain；
- Vote 对 CN/DN 分别判断 quorum；
- paired research run 不应因一个 branch 失败而删除另一个 branch，主分析按预注册 ITT 处理。

## 6. 两种合理反方立场

### 立场 A：只保留集中式

它在工程上最成熟，最终输出自然，且 coordinator 本身可能是增益来源。若 Standard-D pilot 显示 false split 很高、deterministic answer 经常 abstain、成本上升而质量无改善，这一立场成立。但研究仍应报告负结果，而不是在实现前排除分布式对照。

### 立场 B：采用 hybrid 作为唯一新 Standard

`DN + coordinator Compose` 可能是最实用产品：分布式候选治理降低议程风险，composer 保留自然文字。但如果立即把它作为唯一新架构，就无法知道收益来自 DN 还是 composer，也不能满足真正 coordinator-free 的研究端点。更合适的是先把 SG3 作为 2×2 cell；若 fidelity 和产品人评最好，再把它提升为产品呈现层，而不是认知权威层。

## 7. 决策与实施顺序

1. 先冻结协议词汇和 manifest 因子，不改 Paper A C0–C6 的主效应；把 C4 正式命名为 `Traceable-Quick-C@N3`。
2. 修复产品 Quick N=2 enforcement，并让产品/研究两种 Quick 都记录 classification basis。
3. 把 post-revision artifact 抽成可复用的 branch root。
4. 实现 Align schema、deterministic clustering、DN candidate lineage 和 DR。
5. 实现 Standard 的 CN/DN branch isolation；确保任一 branch failure 不污染另一 branch。
6. 用 deterministic mock 完成 order/permutation/parity tests。
7. 在 Stage 0 pilot 只用 screening split 冻结 align threshold、quorum、tie/abstain 和 renderer。
8. 将 Planning 的 per-topic SectionCompose 替换为单一 GlobalCompose，并实现 Normalize-to-Final lineage、catch-all topic、context cap 与 global-compose fallback。
9. 在 G2 决定治理 2×2 的样本量与预算；不依据 confirmatory 结果选择是否运行。

## 8. 最终判断

Coordinator 应在 MMD 中被保留三次：作为 Quick 的唯一认知聚合方式、Standard 的兼容默认和主流研究端点、Planning 从 Outline、topic Normalize 到单一 GlobalCompose 的完整结构/表达治理。分布式架构最适合只从 Standard 切入，并以权威 ledger + deterministic render 形成真正不同的端点。

这种融合比“新架构替换旧架构”更符合 MMD 的研究定位：同一个框架既能研究 sampling、diversity、vote 和 deliberation，也能研究候选本体与最终表达究竟应该由一个 coordinator、一个 peer group，还是二者的混合来治理。

完整证据台账见 [`sources.md`](./sources.md)，关键不确定性与竞争性结论见 [`analysis.md`](./analysis.md)。
