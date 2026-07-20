# Critical Analysis: MMD 研究定位与可发表问题

## Dimension: 项目研究就绪度
- Evidence-backed finding: MMD 已具备协议实现、结构化 trace、cost/timing、quorum、三种模式和 HLE adapter；LiteLLM 分支提供了更适合批量调用的 Python/Proxy 表面。
- Consensus view: 框架“能跑”不等于研究平台“能复现”。
- Assessment: 当前最缺的是 experiment manifest、每次内层调用 ledger、重复运行、统一 baseline、版本冻结、数据导出和统计分析，而不是协议阶段本身。
- Limitation: main README 对 M6 状态滞后；两个分支能力没有自动 parity suite。这会造成论文中系统描述与真实运行不一致。
- Comparison: Fusion 是产品化托管流水线；MMD 的优势是本地可审计，但需要把这种可审计性变成标准化数据集。

## Dimension: 多模型增益的机制
- Evidence-backed finding: 早期 MAD 论文报告多轮 debate 增益，但后续受控研究表明 majority vote/多采样解释了相当部分收益，且效果取决于 reasoning vs knowledge 任务。
- Consensus view: “多算几次”通常能提高至少部分任务表现；“让模型互相说话”是否有额外价值并无统一结论。
- Assessment: MMD 的主实验必须固定或显式建模总成本/token，并包含 single strong、same-model multi-sample、majority vote、quick aggregation 和 Fusion/MoA-style judge baselines。
- Limitation: 各论文模型、prompt、任务和预算不同，不能用跨论文百分点直接比较。
- Stakeholder difference: 产品团队关心 Pareto 前沿；学术审稿人会追问相同 test-time compute 下的额外机制收益。

## Dimension: 有效多样性
- Evidence-backed finding: 最新研究将初始观点多样性、置信度和低错误相关性视为关键，而非 agent 数量本身。
- Consensus view: 异构模型可能提供互补错误，但“不同厂商/模型名”只是弱代理。
- Assessment: 应预注册“有效多样性”指标：初始答案熵、pairwise error correlation、oracle coverage、语义距离和独特正确 claim 覆盖；用它们预测 MMD 的边际增益。
- Limitation: 仅有 embedding distance 可能测到文风而非认知互补性；需要 ground-truth error correlation 与开放任务的 rubric coverage 双轨。
- Relevant comparison: Fusion 用固定/自选模型名单，公开研究将收益部分归因于多样性，但同模型自融合也有 +6.7pt，说明随机路径和 synthesis 本身是重要混杂因素。

## Dimension: 角色与协议瓶颈
- Evidence-backed finding: MMD 的 consensus label 由显式 ballots 的确定性函数给出；但 candidate claims 先由单一 coordinator normalize，最终 prose 也由 coordinator compose。
- Consensus view: 显式投票和 trace 提升可审计性。
- Assessment: “没有单一模型拥有裁决权”只能成立在候选集已经正确、完整的条件下。Normalize coordinator 控制候选本体和覆盖面，是潜在的隐性议程设置者；compose 则控制措辞和遗漏。
- Limitation: `source_claim_ids` 能揭示遗漏但不能自动阻止遗漏；critical objection 的单票 veto 也可能被低质量模型滥用。
- Research opportunity: candidate recall、dissent survival rate、correct→wrong / wrong→correct revision transition、veto precision/recall 是 MMD 独有且可测的过程指标。

## Dimension: 成本、延迟与可靠性
- Evidence-backed finding: 默认 standard 三模型核心约 14 次调用，远高于 Fusion 默认流水线和 MMD quick；planning 还按 topic 放大。Fusion 官方估计默认约单次 4–5 倍且延迟 2–3 倍。
- Consensus view: 质量提升必须与成本和 wall-clock 同报。
- Assessment: 只用 token 作为成本代理不够；必须报告真实 USD、输入/输出/推理 token、搜索/tool 费用、TTFT、总延迟、p50/p95、失败/partial 率。
- Limitation: 闭源价格和 routing 会变；美元成本需要版本化价格快照和 provider 返回的实际账单。
- Relevant comparison: DRACO 显示更多输出 token 不等于更高分，故输出长度必须作为协变量而非“质量”。

## Dimension: 评测有效性
- Evidence-backed finding: DRACO 的 judge 选择可导致绝对分数大幅变化；OpenRouter 更换 judge 后也明确说与原论文不可直接比较；LLM judge 有多种系统偏差。
- Consensus view: 闭集任务优先用确定性评分，开放任务才使用 rubric judge，并需要人评校准。
- Assessment: 开放任务至少采用三 judge、候选顺序随机/反转、模型身份匿名；抽取 15–20% 进行双人盲评并报告 inter-rater reliability。
- Limitation: DRACO 任务/score rubric 可被搜索到；tools-on 实验必须阻断 rubric 域名并保存搜索日志。
- Stakeholder difference: benchmark owner/vendor 可能优化自己系统；独立复现应报告 intent-to-treat（过滤/失败计错）和 per-protocol 两套结果。

## Dimension: OpenRouter Fusion 竞品证据
- Evidence-backed finding: Fusion 在单一 DRACO benchmark 上报告面板优于 solo；工具集合被控制，污染域被屏蔽，并披露 Fable 缺失样本和 judge 改动。
- Consensus view: 结果足以证明 Fusion 是强 baseline，但不足以证明所有任务、所有 budget 或异构多样性本身的普遍优势。
- Assessment: OpenRouter 最强的产品点是低摩擦、动态调用、web tools 和较短管线；MMD 最强的研究点是过程 trace、显式 dissent 和可做因果 ablation。
- Limitation: vendor-run、仅 100 个英语深研任务、未见完整逐任务原始产物与重复生成分布。
- Horizontal comparison: Fusion 对应 quick/judge-style 聚合；MMD standard 的真正对手应同时包括 vote-only 与多轮 MAD，而不是只和 Fusion 比。

## Dimension: 自适应编排与 LiteLLM
- Evidence-backed finding: iMAD、RouteLLM 和 cascades 表明动态触发/路由可显著改善成本—质量；MMD LiteLLM 分支已有 `off/required/auto` policy 和 Router model discovery 雏形。
- Consensus view: 对所有题无条件运行最贵协议通常不是 Pareto 最优。
- Assessment: 第二篇论文应学习“是否 deliberation、选哪些 panel、是否进入 critique/revise、何时早停”，目标是受约束的 quality maximization，而非单一 accuracy。
- Limitation: 当前 auto 是启发式，不是经过校准的决策器；LiteLLM 接口和上游意愿持续变化。
- Ecosystem view: 先发布独立 package + benchmark trace schema，再争取 LiteLLM 的通用 orchestration hooks/示例，接受概率高于一次性合入整套策略。

## Non-Consensus Or Counterintuitive Insight
- Claim: MMD 最有潜力的贡献不是“更民主的确定性投票”，而是证明何时应该**保留分歧而不是追求共识**，并用 disagreement 作为选择性计算和人工升级信号。
- Evidence: vote 常可解释 MAD 增益；错误 debate 会从众或把正确答案改错；MMD 恰好保存 objections、revision 和 source lineage。
- Conditions: 任务有可验证真值/高质量 rubric，trace 完整，候选 normalization recall 可审计。
- Falsification: 如果 disagreement 与错误、收益或人评升级价值均无稳定关系，trace 的产品/学术价值会显著下降。

## Competing Conclusions
| Conclusion/perspective | Supporting evidence | Conditions required | Main weakness |
|---|---|---|---|
| A. 异构 MMD 在固定预算下能形成优于单强模型和同模型多采样的 Pareto 前沿 | 多模型 ensemble/MoA/Fusion 和 diversity 研究 | 低错误相关性、合适 coordinator、任务足够难 | 可能只是额外 compute/更强 synthesizer |
| B. 大多数收益来自采样+投票，standard MMD 的多轮协议不划算 | Debate-or-Vote、Voting-or-Consensus、standard 14-call 成本 | 同质/高相关模型、闭集 reasoning、没有可靠 confidence | 可能低估开放知识任务、异构 agents 和 structured critique |
| C. MMD 的首要价值是 calibrated uncertainty/audit，而非最高平均分 | traceability、dissent、judge bias、高风险任务需要升级 | disagreement 能预测错误且人评成本可接受 | 很难用单一 leaderboard 展示，需新的过程评测 |
