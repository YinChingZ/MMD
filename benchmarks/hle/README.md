# HLE Adapter for MMD

This folder adapts MMD to the official
[centerforaisafety/hle](https://github.com/centerforaisafety/hle) evaluation
flow without changing the main app.

The adapter produces an HLE-compatible predictions file:

```json
{
  "hle_question_id": {
    "model": "mmd-standard-model_a+model_b+model_c",
    "response": "Explanation: ...\nAnswer: ...\nConfidence: 80%",
    "usage": { "cost_usd": 0.1234, "has_unknown_pricing": false }
  }
}
```

You can then pass that file to HLE's official `run_judge_results.py`.

## 跑一轮完整 HLE 测试（真实 API）

下面是一轮完整测试的端到端流程：导出完整 HLE `test` split，使用 MMD
生成所有题目的 predictions，再用官方 HLE judge 计算指标。

> Cost note: HLE 当前约 2,500 题。MMD `standard` 模式每道文本题大约会发起
> 15 次模型调用（3 propose + 3 critique + 3 revise + 1 normalize + 3 vote +
> 1 compose + 1 HLE formatter）。先用 `--max-samples 3` 试跑，确认模型、限流、
> 输出格式和花费都符合预期后，再移除 `--max-samples` 跑完整集。

1. 从仓库根目录安装 Node 依赖：

```bash
npm install
```

2. 导出完整 HLE 数据集：

```bash
cd benchmarks/hle
python -m pip install -r requirements.txt
python export_hle_dataset.py \
  --dataset cais/hle \
  --split test \
  --out data/hle-test.jsonl
cd ../..
```

3. 配置真实模型。MMD 复用 CLI 的模型配置文件：

```bash
cp apps/cli/models.config.example.json apps/cli/models.config.json
cp apps/cli/.env.example apps/cli/.env
```

编辑 `apps/cli/models.config.json`，填入每个参与模型的 OpenAI-compatible
`baseUrl` 和真实 `modelId`；编辑 `apps/cli/.env`，填入配置里引用的 API key
环境变量。不要把真实 key 写进 README 或提交到 git。

4. 先跑 3 题 smoke test：

```bash
npx tsx benchmarks/hle/src/run-mmd-predictions.ts \
  --input benchmarks/hle/data/hle-test.jsonl \
  --output benchmarks/hle/out/mmd_hle_predictions.smoke.json \
  --config apps/cli/models.config.json \
  --mode quick \
  --max-samples 3 \
  --num-workers 1 \
  --timeout-ms 180000 \
  --retries 0 \
  --cost-limit-usd 1 \
  --fresh
```

确认 `benchmarks/hle/out/mmd_hle_predictions.smoke.json` 里每条记录都有
`model`、`response`、`usage`。其中 `response` 应该包含 `Explanation:`、
`Answer:`、`Confidence:` 三行。

5. 跑完整 predictions。移除 `--max-samples`，建议第一次完整跑用
`--num-workers 1`，等确认 provider rate limit 后再提高：

```bash
npx tsx benchmarks/hle/src/run-mmd-predictions.ts \
  --input benchmarks/hle/data/hle-test.jsonl \
  --output benchmarks/hle/out/mmd_hle_predictions.json \
  --config apps/cli/models.config.json \
  --mode standard \
  --num-workers 1 \
  --timeout-ms 300000 \
  --retries 0 \
  --cost-limit-usd 5
```

这个命令会自动断点续跑：如果 `benchmarks/hle/out/mmd_hle_predictions.json`
已经存在，已完成的题目会被跳过。只有想从头重跑时才加 `--fresh`。
`--cost-limit-usd` 是单道题的一次 MMD run 成本上限，不是整轮 HLE 的全局预算。
如果看到 `timeout after 40000ms`，通常是 `quick` 模式默认单次模型调用超时
只有 40 秒；HLE 题目和 OpenRouter 排队都可能超过这个时间。把
`--timeout-ms` 提高到 `180000` 或 `300000` 后直接重跑同一个输出文件即可，
不要加 `--fresh`，适配器会跳过已经完成的题目。

6. 用官方 HLE judge 评分。官方 judge 使用 `openai-python`，需要可用的
`OPENAI_API_KEY`。在另一个目录克隆官方仓库：

```bash
git clone https://github.com/centerforaisafety/hle ../hle
cd ../hle
python -m pip install -r requirements.txt
cd hle_eval
python run_judge_results.py \
  --dataset cais/hle \
  --predictions /absolute/path/to/MMD/benchmarks/hle/out/mmd_hle_predictions.json \
  --num_workers 2 \
  --judge o3-mini-2025-01-31
```

官方脚本会在当前 `hle_eval` 目录写出
`judged_mmd_hle_predictions.json.json`，并打印 `Accuracy` 与
`Calibration Error`。如果 judge 中途因为限流失败，直接重跑同一条命令；
官方脚本会复用已经写出的 judged cache。

MMD 当前是 text-only provider 接口。默认
`--image-policy mark-unsupported` 会把 HLE 图片题写成 `Answer: unsupported`、
`Confidence: 0%`，从而明确记录当前系统没有参与视觉题。等 MMD 支持多模态后，
再把这个 policy 换成真正的 image-aware 路径。

## 1. Export the HLE dataset

Install the Python dependency used by the official HLE repo:

```bash
cd benchmarks/hle
python -m pip install -r requirements.txt
python export_hle_dataset.py --dataset cais/hle --split test --out data/hle-test.jsonl
```

The exported JSONL keeps the official fields (`id`, `question`, `answer`,
`image`, and any metadata columns).

## 2. Configure MMD models

Use the same model config as the main CLI:

```bash
cp apps/cli/models.config.example.json apps/cli/models.config.json
cp apps/cli/.env.example apps/cli/.env
```

Fill in `apps/cli/models.config.json` and the API keys named by that file.

## 3. Generate HLE predictions

From the repository root:

```bash
npx tsx benchmarks/hle/src/run-mmd-predictions.ts \
  --input benchmarks/hle/data/hle-test.jsonl \
  --output benchmarks/hle/out/mmd_hle_predictions.json \
  --config apps/cli/models.config.json \
  --mode standard \
  --num-workers 1
```

Useful flags:

- `--max-samples 3` runs a small smoke test.
- `--mode quick` lowers cost by skipping critique/revise/vote.
- `--fresh` ignores an existing output file instead of resuming it.
- `--image-policy mark-unsupported` is the default because MMD is currently
  text-only; image questions are recorded with confidence `0%`.
- `--image-policy skip` leaves image questions out of the predictions file.
- `--image-policy append-url` includes the image URL in the text prompt, but
  still does not provide true vision input.
- `--provider mock` runs without API keys, useful only for adapter smoke tests.

## 4. Judge with official HLE

In a clone of `centerforaisafety/hle`:

```bash
cd hle_eval
python run_judge_results.py \
  --dataset cais/hle \
  --predictions /absolute/path/to/MMD/benchmarks/hle/out/mmd_hle_predictions.json \
  --num_workers 100
```

The official HLE README currently describes the dataset as `cais/hle`, loaded
with `datasets.load_dataset("cais/hle", split="test")`, and its predictions
script writes a JSON object keyed by question id. The judge script reads the
`response` field from each prediction and appends `judge_response`.

## Limitations

MMD's current model provider interface sends text-only chat completions. HLE
contains multimodal items, so this adapter explicitly marks image questions as
unsupported by default instead of pretending to evaluate vision capability.
When MMD gains native multimodal input, this folder is the right place to add
an image-aware provider path.
