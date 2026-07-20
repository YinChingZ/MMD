# Self-Review

Reviewer stance：skeptical multi-agent systems and experimental-design reviewer.

## Substantive Weaknesses Found

1. Issue：初稿把“Quick 严格 N=2”和“Paper A C4 保持不变”同时写入，但 Paper A 已冻结主实验 N=3。
   - Why it matters：若 C4 用 N=2、C5 用 N=3，`C5−C4` 会混入 panel-size effect；若普通产品 Quick 被默默跑成 N=3，又失去产品语义。
   - Revision made：明确区分产品 `Quick@N2` 与研究 `Traceable-Quick-C@N3`；普通 API 强制 N=2，实验 runner 只通过 manifest override 运行 N=3。
2. Issue：初稿把内部 2×2 描述成“分解 Normalize 与 Compose 权力”，措辞接近天然可加的因果成分。
   - Why it matters：CN/DN 会产生不同 candidate sets，投票输入和数量也会改变；效应是 pipeline-conditional，不是固定常数。
   - Revision made：改称 conditional protocol contrasts，明确输入中介和 interaction 的解释边界。
3. Issue：初稿对 Planning 锁定同一 coordinator 的一致性收益强调较多，对相关偏差不足。
   - Why it matters：同一个模型既决定 outline 又决定 candidate 和 prose，可能让同一遗漏贯穿全程。
   - Revision made：保留产品默认锁定，但加入 same-vs-role-swapped Stage 4 sensitivity，并禁止把文风一致当作正确性证据。
4. Issue：初稿将 Standard-D 直接写成产品第二路径，却没有充分处理开放式输出的成熟度。
   - Why it matters：deterministic ledger 对闭集任务可评测，对一般产品问答未必具有可接受的表达质量；optional polish 又可能重新引入编辑偏差。
   - Revision made：Standard-D 在 presentation/fidelity gate 前标为 experimental/research；闭集 R/K 先评测，开放输出同时保留 canonical ledger 与非权威 polish。
5. Issue：关键外部判断主要集中在 sources appendix，正文可追溯性不够直接。
   - Why it matters：读者难以区分本地推论与文献证据。
   - Revision made：在 executive summary 和 coordinator 主流性判断附近加入 LLM-Blender、MoA、Magentic-One、Free-MAD、EoT、MacNet 和 topology paper 的直接链接与日期。
6. Issue：初版仍让 Planning 输出多个独立 section，并由代码拼接摘要，未满足后续确认的“整体融合答案”。
   - Why it matters：独立 section 无法共同处理跨主题依赖、冲突和全局取舍，Planning 仍是汇编器而不是规划 coordinator。
   - Revision made：改为 per-topic deliberation/normalize 后进入单一 GlobalCompose；topics 只作为 trace artifacts，用户得到一个带 candidate lineage 的融合 `final_answer`。

## Final Checks

- Topic-specific dimensions：是；覆盖 MMD 三模式、artifact branching、Normalize/Compose 权力和 Paper A estimands。
- Dated source support：是；本地来源和外部一手论文列于 `sources.md`，正文关键论据已有直接链接。
- Explicit uncertainty：是；明确缺少 MMD 双架构实测、align 阈值和 Planning coordinator sensitivity 数据。
- Multiple perspectives：是；比较全集中、全双轨、按模式融合、统一 hybrid 四种立场。
- Non-cosmetic revisions：是；修复 Quick N2/N3 设计冲突，收紧因果措辞，并改变 Standard-D 产品发布定位。
