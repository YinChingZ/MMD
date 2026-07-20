# Paper A Study Plan Self-Review

Reviewer stance: skeptical area-chair / methods reviewer.

## Substantive weaknesses found and revisions applied

1. **初版倾向把所有公平性问题压缩成一个“compute-matched”实验。**
   - 风险：Standard 的额外阶段本身就是机制；强制完全相同 token 可能改变协议，而只比较自然配置又无法回答预算价值。
   - 修订：拆成 Structural track 与 Budget-matched track，分别回答阶段机制和用户购买决策。

2. **“异构模型效应”容易与成员能力和成本混杂。**
   - 风险：不同厂商无法随机分配，不能给出训练来源的纯因果结论。
   - 修订：增加 screening split、ability/cost matching、held-out confirmatory tasks、协变量和主张阶梯，禁止普遍因果措辞。

3. **主实验规模可能因模型×组合×协议×任务全因子而失控。**
   - 风险：预算耗尽后只有不完整条件，反而无法发表。
   - 修订：把研究分为 screening/design lock→RQ1 decomposition→RQ2/H1 diversity confirmation→RQ3/H2–H3 deliberation confirmation→data-lock 后扩展；角色消融、开放研究和外部系统对照不进入最小主实验。

4. **过程指标中的 candidate recall 在开放任务上缺少稳定真值。**
   - 风险：用 embedding 或 LLM judge 生成“伪精确”指标。
   - 修订：闭集任务做正式 candidate recall；开放任务只有在有 rubric claim/人工标注时量化，否则降为案例分析。

5. **重复运行可能被误当作独立样本。**
   - 风险：虚增样本量和显著性。
   - 修订：明确 task 是主要抽样单元，repetitions 仅估计同一 task-condition 的随机性，统计采用 paired/task-cluster 方法。

6. **外部多模型系统与 MMD 的内部资源通常不可完全对齐。**
   - 风险：把产品级比较错误解释为协议因果实验。
   - 修订：具体外部产品不进入预注册主实验；数据锁定后如有必要，只做同任务、同评分口径的 naturalistic comparison，内部机制结论仅来自可控消融。

7. **初版将 MMD 放在了过高的叙事位置。**
   - 风险：研究容易被理解为证明某一框架优于其他系统，而不是解释多模型协作的性能来源；单一实现上的结果也可能被不当推广。
   - 修订：将总问题改为分解 sampling、有效多样性、aggregation、deliberation 与 coordinator 的贡献；异构性和结构化审议作为后续增量检验。MMD 明确定位为可追溯、可消融的主要实验载体，而非研究对象。

8. **初版研究问题和假设缺少可识别的估计量与判定边界。**
   - 风险：“存在显著交互”“某机制是瓶颈”等表述容易成为事后解释，无法明确对应实验对照，也会强迫团队为证据方向尚不稳定的问题设置假设。
   - 修订：将 RQ1 绑定到嵌套协议增量，将 H1 绑定到 held-out diversity contrast，将 H2/H3 绑定到审议前分歧和 paired error transition；不对总体平均审议收益预设方向。其余机制问题保留为 secondary RQ，只有在预注册前补齐设计后才能升级为确认性假设。

9. **初版把执行计划绑定到六名成员和 20 周周期。**
   - 风险：人员规模、可用工时和 API 吞吐量尚未确定，固定角色与周数会制造虚假精确度，也不利于团队扩缩容。
   - 修订：改为 WP1–WP8 的量化交付物、实验单元公式、独立复核约束和 M0–M7 gate 依赖；实际周期由 dry run 后的有效吞吐量和关键路径动态计算。

## Final checks

- 研究问题是否可证伪：是。
- 研究对象与实验实现是否明确区分：是。
- 正负结果是否都有论文路径：是。
- Primary 与 exploratory 是否区分：是。
- 成本和失败是否进入主分析：是。
- 统计单位是否正确：是，task-level。
- 未决选择是否明确：是，D1–D13。
- 下一版所需用户输入是否明确：是，见第 23 节。
