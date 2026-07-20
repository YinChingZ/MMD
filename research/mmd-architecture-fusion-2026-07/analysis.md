# Critical Analysis：MMD 集中式与分布式协调架构融合

## Dimension：认知权力拓扑

- Evidence-backed finding：MMD 的 deterministic host orchestrator 负责流程、预算、quorum 和事件；LLM coordinator 则在 Normalize 决定候选集合、在 Compose 决定最终文字。要移除的是后者的单一认知权力，而不是 host orchestration。
- Consensus view：集中式 aggregator/orchestrator 是成熟且常见的模式。LLM-Blender 使用 ranking+generative fusion，MoA 使用分层聚合，Magentic-One 由 lead Orchestrator 管理开放式任务。
- Assessment of consensus：证据足以支持“应保留 coordinator 作为重要基线和产品架构”，不足以支持“coordinator 对所有任务最优”。Free-MAD、EoT、MacNet 和 topology research 都表明决策/通信拓扑本身会改变表现与成本。
- Data limitations：没有 MMD 自身集中与分布两端的同题 paired 数据。
- Stakeholder differences：产品侧重最终文字和可预测行为，研究侧重因果识别与 trace，审计侧重避免单点议程设置。
- Relevant comparison：外部研究同时存在强中央融合器、分层/图拓扑和无共识方案；MMD 最有价值的不是选边，而是用同一 claim protocol 对照这些治理机制。

## Dimension：模式—任务匹配

- Evidence-backed finding：Quick 没有 critique/revise/vote，当前靠 2 个 proposals、单一 Normalize 的 source coverage 和单一 Compose 形成答案；Standard 有完整审议；Planning 先 outline，再按 topic 并行运行 Standard，并由 coordinator 写每个 section。
- Consensus view：协议选择应受任务结构影响。Voting or Consensus 发现 decision protocol 在 reasoning 和 knowledge 上的效果不同；Magentic-One 的集中式 orchestrator 针对长时开放任务；Free-MAD 则针对推理型 MAD 的从众和成本。
- Assessment of consensus：按模式专门化比全局统一治理更有证据基础。
- Data limitations：MMD 尚未直接比较同一任务在 Quick/Standard/Planning 的治理变体。
- Relevant comparison：Quick 的 N=2 无稳定多数，peer-only 选择容易出现 1–1；Planning 需要结构和连贯文本；Standard 的 N=3 和显式 ballots 最适合比较集中/分布式治理。

## Dimension：因果可识别性

- Evidence-backed finding：Paper A 的 C4/C5/C6 已把集中式 Normalize/Compose 固定为共同下游，C6−C5 因而估计 coordinator 架构下的 critique/revise 增量。
- Consensus view：一次只改变一个协议变量最容易解释；Voting or Consensus 明确强调其系统比较只改变 decision protocol。
- Assessment of consensus：把所有 C4–C6 直接替换成分布式版本会改变 Paper A 的历史 estimand；把 coordinator 完全删除也失去研究主流架构的机会。最稳妥的做法是保持 C0–C6 主干，并把 Standard 的同一 post-revision claims 分支到另一治理路径。
- Data limitations：集中和分布式路径产生不同 candidate sets，因此投票不能共享；“完整架构效应”包含 normalization 与 rendering 两部分。
- Relevant comparison：可以用内部 2×2 artifact branching 分离两部分，而不需要向产品暴露四种 Standard。

### 推荐的 Standard 研究分支

共同上游：`Propose → Critique → Revise → postRevisionClaims`

1. `CN`：单 coordinator Normalize；
2. `DN`：N 个 peer AlignmentSets → deterministic clustering；
3. 每个 candidate set 各自进行一次 N-model Vote 和相同代码分类；
4. 对两个 voted ledgers 分别产生 coordinator compose (`CR`) 与 deterministic render (`DR`)。

由此得到：

| Cell | Normalize governance | Render governance | 产品/研究角色 |
|---|---|---|---|
| CN+CR | centralized | coordinator prose | 当前 Standard；Paper A C6 |
| CN+DR | centralized | deterministic | 研究内部：隔离 Compose 效应 |
| DN+CR | distributed | coordinator prose | 研究内部：隔离 Normalize 效应并保留流畅表达 |
| DN+DR | distributed | deterministic | 新的 coordinator-free Standard |

N=3 时，共享上游的完整 2×2 需要 `6N+3=21` 次核心调用；只跑两个端点需要 `6N+2=20` 次。相对两个独立端点的 29 次调用，artifact branching 明显更高效；2×2 比端点 paired 只多一次 DN+CR compose。

## Dimension：信息保真

- Evidence-backed finding：集中式 Normalize 的主要风险是遗漏、错误合并或重写；分布式 alignment 若保证每个 raw claim 进入一个 cluster，可程序化消除“无 lineage 的遗漏”，但会引入 false merge、false split 和 peer conformity。
- Consensus view：LLM 的讨论/聚合可能传播错误或从众；Free-MAD 用 trajectory scoring 和 anti-conformity 处理这一问题，topology propagation research 也强调网络结构决定正误信息扩散。
- Assessment of consensus：分布式不等于无偏，只是把单点偏差换成阈值与群体偏差。因此 candidate recall 不能作为唯一成功指标。
- Required measures：source coverage invariant、false merge、false split、minority distinguishability、alignment disagreement、order stability、final selection/compose fidelity。
- Relevant comparison：CN 和 DN 必须使用同一 raw claim set；candidate crosswalk 应基于 source claim IDs/语义审计，不应假设 candidate IDs 可直接匹配。

## Dimension：最终答案构造

- Evidence-backed finding：MMD 的 Compose prompt 声称 editor not judge，但仍生成 `final_answer`；Planning 的 section-compose 同样生成最终段落。纯 ledger 对 R/K 的闭集决策可确定性选择，对开放式答案和长文计划不能天然替代生成式融合。
- Consensus view：LLM-Blender、MoA 等采用生成式融合，说明 final prose synthesis 对开放任务有实际价值；但生成器也可能加入或抹去信息。
- Assessment of consensus：Standard-D 应把 deterministic ledger/render 作为权威结果；可以有可选的非权威 prose polish，但 Paper A scorer 和 trace 不能依赖它。Planning 则应保留 coordinator prose，并通过 lineage contract 限制它。
- Data limitations：尚未定义适用于所有 R/K scorer 的确定性 tie/abstain 规则，也没有开放任务的 ledger-vs-prose 人评。

## Dimension：Quick 架构选择

- Evidence-backed finding：Quick 设计为 N=2 且没有显式 vote；API 目前并未在缺省时强制只选两个模型。当前代码把 normalize 的 source coverage 转成隐式 approve ballots。
- Consensus view：Quick 的目标是低延迟、低认知负担，而不是完整治理研究。
- Assessment：产品只保留 centralized Quick 最合适。N=2 peer topology 缺少多数决，distributed alignment 虽可能保持同样调用数，却没有便宜、稳定的最终文字与 tie-break。
- Required fixes：普通产品运行时强制 N=2；显式冻结 coordinator；将无 vote 的标签表述为 `corroborated_all/single_source/conflicting/alignment_uncertain` 或至少在 trace 中区分 coverage-derived 与 ballot-derived consensus。Paper A 因 C4/C5 必须共享 N=3 proposals，应把 C4 命名为 `Traceable-Quick-C@N3`，由 experiment manifest 显式运行，不能与产品 Quick 混称。
- Counterargument：2 个 align 调用可并行，可能比 sequential Normalize+Compose 更快。该观点值得 microbenchmark，但不足以让 Quick 同时暴露双架构，因为最终答案选择和 1–1 disagreement 仍未解决。

## Dimension：Planning 架构选择

- Evidence-backed finding：Planning 已经是 centralized/hybrid：单 coordinator Outline；每 topic 的 Normalize 与 section-compose；代码确定性拼接 TLDR。它需要最多 T 个并行 topic，每个 topic 运行完整审议。
- Consensus view：开放式长时任务通常受益于 lead orchestrator 和生成式 aggregation；Magentic-One 是直接先例。跨域的多机器人工作还显示 hybrid 可能优于纯集中或纯分布，但不能直接外推效应量。
- Assessment：Planning 不应在首轮提供双治理路径，应强制层级式 coordinator-led Normalize-to-Final contract。当前 per-topic section compose 加 TLDR 拼接只能形成并列汇编；最终应由一次 GlobalCompose 读取所有 topic ledgers，生成一个融合答案。
- Required contract：同一 coordinator role/config 在 run 内锁定；Outline 与 per-topic Normalize 保留；Vote/classify 后不再生成用户可见的独立 sections，而是统一进入 GlobalCompose。每个输出 span 必须列出 `source_candidate_ids`，跨主题新推论标成 `coordinator_synthesis`，disputed 不得进入无条件结论。
- Required hardening：增加代码生成的 `cross_cutting_risks_and_omissions` catch-all topic；GlobalCompose 只读取压缩 candidate ledgers；超出 context 时使用内部 topic briefs；失败时回退到结构化 ledgers，不丢弃整个 run。
- Contradiction found：现有协议称 outline 遗漏可由后续模型在“对应主题”中恢复，但真正被漏掉的主题可能没有对应容器。因此 outline 风险不是完全可恢复，catch-all 或 coverage audit 是必要补强。

## Dimension：成本、延迟与失败

- Evidence-backed finding：当前 N=3 Standard 为 14 次核心调用；DN+DR Standard 为 15 次。前者有 6 个 LLM 串行阶段，后者有 5 个（Align 可 fan-out，最终 render 为代码）。Planning 当前约为 `1+T(4N+2)`。
- Assessment：Standard-D 的总调用数略高，但串行深度可能更低；重复发送 claims 给 N 个 aligners 可能提高输入成本。没有实测前不能声明更快或更便宜。
- Failure differences：Central Normalize/Compose 是 run-level single point；distributed Align 可 quorum 降级，但阈值在 partial quorum 下可能不稳定。DN 默认应保守分开 unresolved claims，不应在证据不足时合并。
- Planning issue：新的 GlobalCompose 是显式单点，但它替代了 T 次 section compose；必须保留 topic ledgers、固定 retry 和结构化 fallback。调用数约从 `1+T(4N+2)` 降到 `2+T(4N+1)`，实际 latency 仍取决于最终大上下文调用。

## Dimension：产品与研究接口

- Evidence-backed finding：当前 mode 只有 quick/standard/planning；Paper A 则需要更细的条件和 artifact branch。
- Assessment：不要把四个 2×2 cells 暴露成四个产品模式。产品接口应保持三种 mode，并仅在 Standard 增加 `governance: centralized | distributed`；研究 manifest 另有独立的 `normalization_governance` 与 `render_governance` 因子。
- Compatibility：现有 `standard` 默认为 centralized；新值必须显式 opt-in。Quick/Planning 拒绝 distributed governance，而不是静默忽略。
- Naming：避免说“无 orchestrator”；建议把新路径称为 `peer-governed` 或 `distributed epistemic governance`，因为 deterministic host orchestrator 仍然存在。

## Non-Consensus Or Counterintuitive Insights

### 1. 最可能适合产品的 hybrid，不一定适合第一轮研究

- Claim：`distributed Normalize + coordinator Compose` 可能兼顾候选治理和文字质量，但它不是最干净的产品端点或研究端点。
- Evidence：生成式 fusion 对开放答案有价值；集中式 Normalize 又是当前主要议程瓶颈。
- Conditions：compose 能通过 candidate lineage/fidelity checker 被严格约束。
- What would weaken it：composer 仍频繁引入新 claim 或掩盖 disputed；此时只有 DN+DR 才是真正可信的权威输出。
- Research implication：把 DN+CR 保留为内部 2×2 cell，而不是先把它命名成第三种 Standard。

### 2. Planning 的单 coordinator 比 Quick 更容易被合理保留

- Claim：尽管 Planning 使用 coordinator 的次数最多，它反而是最不适合首轮去中心化的模式。
- Evidence：Planning 的目标是跨 topic 形成统一、可执行的整体答案；外部开放 agent 系统常由 lead orchestrator 管理；当前 deterministic TLDR assembly 无法真正做跨主题综合。
- Conditions：必须强化 lineage、coverage、context cap 和 global-compose failure fallback。
- What would weaken it：若实验显示 distributed topic governance 加 coordinator-only presentation 显著降低 omissions 且成本可控，则可在后续引入 peer-audited Planning。

## Competing Conclusions

| Conclusion/perspective | Supporting evidence | Conditions required | Main weakness |
|---|---|---|---|
| 全部保持集中式 | 主流 fusion/orchestrator 先例；实现成熟；最终文字自然 | coordinator recall/fidelity 审计可靠 | 无法研究或缓解单点议程权 |
| 所有模式都双轨 | 完整探索 topology effect | 大预算、统一 renderer、清晰产品 UI | Quick/Planning 条件爆炸，estimand 与产品语义混乱 |
| 按模式融合（推荐） | 任务依赖证据；Standard 最适合 paired branching | Quick/Planning 中央约束强化；Standard 实现 DN ledger | 不能立即回答 distributed Planning/Quick 的效果 |
| coordinator draft + peer audit 的统一 hybrid | 兼顾流畅输出与遗漏申诉 | audit 修复规则可确定、额外成本可接受 | 改变多个机制，最难作因果解释 |

## Provisional Recommendation

1. Quick：产品只保留 centralized classic path，严格 N=2；Paper A 保留 centralized 的 N=3 实验实例。
2. Standard：产品保留 centralized 与 distributed 两种 governance；centralized 仍是兼容默认，distributed 是新的 peer-governed path。
3. Planning：只保留 coordinator-locked path，并把 Normalize-to-Final lineage contract 变成 schema/代码不变量；不在首轮增加 distributed Planning。
4. Paper A：C0–C6 主实验保持原架构和原主要 estimands；预先加入 Standard 的治理 2×2 secondary bridge，共享 post-revision claims。
5. 后续：只有当 Standard-D 的 false-merge、质量、成本和稳定性通过 gate 后，再研究 peer-audited Planning 或 distributed Quick，不直接扩展全部组合。
