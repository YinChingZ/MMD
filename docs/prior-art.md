# 相关工作与竞品分析（Prior Art）

*[English](prior-art.en.md)*

本文档记录在推广/社区讨论过程中调研过的相关项目，避免以后重复调研，也作为 MMD 差异化定位的依据。调研时间：2026-07。

## OpenRouter Fusion Router

- **机制**：panel（最多 8 个模型并行回答，每个模型带网页搜索/工具调用）→ judge 模型读取所有 panel 回答，产出结构化对比分析（共识点、分歧点、覆盖差异、各模型独有见解、盲点——judge "doesn't merge them"，不做文本合并）→ 发起请求的外层模型基于这份分析生成最终答案文字。
- **配置**：`analysis_models`（面板模型，1-8 个）、`model`（judge 身份）、`max_tool_calls`、`temperature`（judge 固定为 0）等。
- **成本**：默认 3 模型面板约为单次调用的 4-5 倍（N 次 panel + 1 次 judge + 1 次外层合成）。
- **溯源**：响应里只有顶层 `model` 字段和生成元数据里的 `router` 字段，没有逐条结论级别的来源追溯。
- **防递归**：内层调用带 `x-openrouter-fusion-depth` 头，防止 panel/judge 再次触发 Fusion。
- **与 MMD 的关键差异**：
  1. 共识判断来自单个 judge 模型的主观解读，而不是对各模型自身显式投票结果做确定性函数计算。
  2. 没有逐条 claim 级别的强制溯源。
  3. 单轮——panel 各答一次，没有 critique/revise 迭代修订立场的过程。
  4. panel 模型自带网页搜索/工具调用，这是 MMD 目前没有的能力。

## EricThomson/litesquad

- **机制**：worker 模型（Gemini/Sonnet/DeepSeek/Mistral/Llama）分发作答 → 单一固定 critic 模型（Grok）批评所有 worker → worker 基于批评修订 → 聚类阶段（GPT-5）提取共同建议 → 最终 judge（Opus）把聚类结果整合成"连贯的最终答案"。
- **定位**："有时两个或五个头脑确实胜过一个。"
- **模型接入**：Gemini/OpenAI/Anthropic 直连，DeepSeek/Mistral/Llama/Grok/Qwen 等经 OpenRouter。
- **用法**：`litesquad "query"`（深度模式，耗时数分钟）/ `--quick`（绕过团队）/ `--web`。
- **明确声明的限制**："无 agentic 工具调用（如网络请求），仅推理"；**无结果溯源机制，不追踪建议来源**。
- **开发阶段**：0 star，20 次提交，Apache-2.0 许可，和 MMD 处于相近的早期原型阶段（不是成熟竞品）。
- **与 MMD 的关键差异**：
  1. 角色和具体模型是绑定死的（worker/critic/clusterer/judge 各自固定某个模型），不是任意 N 个模型对称参与、按比例判定共识——模型数一变就要重新设计管线，不像 MMD 的 `classifyCandidate` 是纯函数、天然支持任意模型数。
  2. 批评是单一固定 critic 单向点评所有 worker，不是模型之间互相批评。
  3. 最终答案由单一 judge 模型主观整合而成，不是对显式投票的确定性分类。
  4. 文档明确承认无溯源机制——这正是 MMD 用 schema 强制要求 `source_claim_ids`（非空必填）专门解决的问题。

## LiteLLM 生态现状

在 `BerriAI/litellm` 的 open + `enhancement` 标签 issue 中按关键词（orchestrator / ensemble / consensus / judge / multiple models / best of）搜索，**没有发现任何"多个模型并行回答，再综合/协商出一个答案"的功能或提案**。最接近的两类：

- `#27550`「Add LLM as orchestrator to choose which LLM to call」——本质是单模型路由/fallback：从多个候选模型里选一个来调用，不涉及多模型输出的综合。
- `llm_as_a_judge` guardrail（相关 issue：`#30731`、`#27888`、`#27767`）——对**单个模型的单次输出**做安全/质量打分来决定是否放行，不是多模型共识机制，命名容易让人误以为相关，实际是另一回事。

结论：litellm 目前只有"路由到哪个模型"和"给单次输出打分"这两层能力，完全没有"多个模型都答一遍、再协商出一个结论"这一层。MMD 所在的能力层在 litellm 生态里目前是空白，不构成重复建设或竞争关系。

## 定位对照表

| 维度 | Fusion Router | litesquad | LiteLLM（现状） | MMD |
|---|---|---|---|---|
| 最终结论产生方式 | 单一 judge 模型主观分析 + 外层模型合成 | 单一 judge 模型（Opus）主观整合 | 不适用（单模型路由/打分） | 对显式投票的确定性函数（比例阈值），无模型拥有裁决权 |
| 逐条溯源 | 仅顶层 `model` 字段 | 明确声明无 | 不适用 | schema 强制 `source_claim_ids`，非空必填 |
| 模型间是否互评 | 否（judge 单向点评 panel） | 单一 critic 单向点评 worker | 不适用 | 是——critique 阶段所有模型互评，revise 阶段可修订立场 |
| 模型数量是否硬编码 | 面板 1-8，判定逻辑未公开 | 角色与具体模型绑定 | 不适用 | 比例阈值，任意 N（3/5/7 均有测试覆盖） |
| 工具/网页搜索 | 有 | 明确声明无 | 提供商能力对接，非本层功能 | 目前没有 |
| 单轮/多轮 | 单轮 | 单轮（含一次修订） | 不适用 | 多轮（critique→revise→vote），也提供 quick 单轮模式 |
| 成熟度 | 生产级基础设施功能 | 早期原型（0 star） | 该能力层生态位空白 | 早期原型（M0-v0.2，CLI） |

**结论**：MMD 与 Fusion、litesquad 的核心差异不在"有没有多个模型参与"，而在于两点：**共识判定权是否被交给某一个模型**（MMD 交给对显式投票的确定性函数，两者都交给一个 judge 模型的主观解读），以及**溯源是否是协议层面的强制约束**（MMD 是，两者都不是/未公开）。在 litellm 生态里，这一整层能力目前不存在。
