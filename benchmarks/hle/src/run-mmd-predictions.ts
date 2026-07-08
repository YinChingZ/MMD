import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  MockProvider,
  OpenAICompatibleProvider,
  RoutingProvider,
  type CompletionUsage,
  type ModelConfig,
  type ModelProvider,
} from "@mmd/model-adapters";
import {
  runDeliberation,
  type DeliberationResult,
  type FormatUserOutputRequest,
} from "@mmd/orchestrator";
import type { RunMode } from "@mmd/protocol";
import { loadModelsConfig } from "../../../apps/cli/src/models-config.js";

type ImagePolicy = "mark-unsupported" | "skip" | "append-url";

interface HleQuestion {
  id: string;
  question: string;
  answer?: string;
  image?: string | null;
  [key: string]: unknown;
}

interface HleFormatterOutput {
  explanation: string;
  answer: string;
  confidence: number;
}

interface HlePrediction {
  model: string;
  response: string;
  usage?: Record<string, unknown>;
  mmd?: Record<string, unknown>;
}

interface ResolvedProvider {
  models: ModelConfig[];
  provider: ModelProvider;
  coordinatorModelId?: string;
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const adapterDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(adapterDir, "../..");

const HLE_OUTPUT_FORMAT: FormatUserOutputRequest = {
  name: "HLEPrediction",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["explanation", "answer", "confidence"],
    properties: {
      explanation: { type: "string", minLength: 1 },
      answer: { type: "string", minLength: 1 },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
    },
  },
  instructions: [
    "Produce the closed-ended benchmark answer expected by Humanity's Last Exam.",
    "The answer field must be concise and exact. For multiple-choice questions, include the option label when available.",
    "The explanation field should summarize only reasoning already present in the final deliberation result.",
    "Confidence must be an integer from 0 to 100 with no percent sign.",
    "If exact confidence is not available, map high consensus to about 80, medium consensus to about 55, and low consensus to about 30.",
  ].join(" "),
};

const { values } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    output: { type: "string", short: "o" },
    config: { type: "string", short: "c" },
    env: { type: "string" },
    provider: { type: "string" },
    models: { type: "string", short: "m" },
    "fail-models": { type: "string" },
    mode: { type: "string" },
    "max-samples": { type: "string" },
    "num-workers": { type: "string" },
    "image-policy": { type: "string" },
    "model-label": { type: "string" },
    "cost-limit-usd": { type: "string" },
    "timeout-ms": { type: "string" },
    retries: { type: "string" },
    "backoff-ms": { type: "string" },
    fresh: { type: "boolean" },
  },
});

async function main(): Promise<void> {
  const inputPath = path.resolve(
    process.cwd(),
    values.input ?? path.join(adapterDir, "data", "hle-test.jsonl")
  );
  const outputPath = path.resolve(
    process.cwd(),
    values.output ?? path.join(adapterDir, "out", "mmd_hle_predictions.json")
  );
  const configPath = path.resolve(
    process.cwd(),
    values.config ?? path.join(repoRoot, "apps", "cli", "models.config.json")
  );
  const mode = parseMode(values.mode);
  const maxSamples = parseOptionalPositiveInt(values["max-samples"], "max-samples");
  const numWorkers = parsePositiveInt(values["num-workers"] ?? "1", "num-workers");
  const imagePolicy = parseImagePolicy(values["image-policy"]);
  const costLimitUsd = parseOptionalPositiveNumber(
    values["cost-limit-usd"],
    "cost-limit-usd"
  );
  const fanoutOptions = {
    timeoutMs: parseOptionalPositiveInt(values["timeout-ms"], "timeout-ms"),
    retries: parseOptionalNonNegativeInt(values.retries, "retries"),
    backoffMs: parseOptionalPositiveInt(values["backoff-ms"], "backoff-ms"),
  };

  loadDefaultEnvFiles();
  for (const envPath of splitCsv(values.env)) {
    loadEnvFile(path.resolve(process.cwd(), envPath));
  }

  const resolved = resolveProvider({
    providerName: values.provider,
    configPath,
    mockModels: values.models,
    failModels: values["fail-models"],
  });
  const modelLabel =
    values["model-label"] ??
    `mmd-${mode}-${resolved.models.map((model) => model.id).join("+")}`;

  const questions = (await loadQuestions(inputPath)).slice(
    0,
    maxSamples ?? undefined
  );
  const predictions = await loadExistingPredictions(outputPath, Boolean(values.fresh));
  const pending = questions.filter((question) => !(question.id in predictions));

  console.error(
    [
      `Loaded ${questions.length} HLE rows from ${inputPath}`,
      `Already predicted: ${questions.length - pending.length}`,
      `Pending: ${pending.length}`,
      `Mode: ${mode}`,
      `Image policy: ${imagePolicy}`,
      `Workers: ${numWorkers}`,
    ].join(" | ")
  );

  await mkdir(path.dirname(outputPath), { recursive: true });

  let completed = 0;
  await runQueue(pending, numWorkers, async (question) => {
    const prediction = await predictQuestion({
      question,
      imagePolicy,
      modelLabel,
      mode,
      resolved,
      costLimitUsd,
      fanoutOptions,
    });
    if (prediction) {
      predictions[question.id] = prediction;
      await writePredictions(outputPath, predictions);
    }
    completed += 1;
    console.error(
      `[${completed}/${pending.length}] ${prediction ? "wrote" : "skipped"} ${question.id}`
    );
  });

  await writePredictions(outputPath, predictions);
  console.log(`Wrote ${Object.keys(predictions).length} predictions to ${outputPath}`);
}

function resolveProvider(params: {
  providerName: string | undefined;
  configPath: string;
  mockModels: string | undefined;
  failModels: string | undefined;
}): ResolvedProvider {
  if (params.providerName === "mock") {
    const modelIds = splitCsv(params.mockModels ?? "model_a,model_b,model_c");
    const failModelIds = new Set(splitCsv(params.failModels));
    return {
      models: modelIds.map((id) => ({ id, provider: "mock" })),
      provider: new MockProvider({ failModelIds }),
      coordinatorModelId: modelIds[0],
    };
  }

  if (params.providerName && params.providerName !== "config") {
    throw new Error(`unsupported --provider "${params.providerName}"; use "config" or "mock"`);
  }
  if (!existsSync(params.configPath)) {
    throw new Error(
      `missing models config at ${params.configPath}; pass --provider mock for a no-key smoke test`
    );
  }

  const config = loadModelsConfig(params.configPath);
  const models = config.models.map((model) => ({
    id: model.id,
    provider: "openai-compatible",
  }));
  const routes = new Map(
    config.models.map((model) => [
      model.id,
      {
        provider: new OpenAICompatibleProvider({
          baseUrl: model.baseUrl,
          apiKeyEnvVar: model.apiKeyEnvVar,
        }),
        apiModelId: model.modelId,
      },
    ])
  );
  return {
    models,
    provider: new RoutingProvider(routes),
    coordinatorModelId: config.coordinatorModelId ?? models[0]?.id,
  };
}

async function predictQuestion(params: {
  question: HleQuestion;
  imagePolicy: ImagePolicy;
  modelLabel: string;
  mode: RunMode;
  resolved: ResolvedProvider;
  costLimitUsd?: number;
  fanoutOptions: {
    timeoutMs?: number;
    retries?: number;
    backoffMs?: number;
  };
}): Promise<HlePrediction | undefined> {
  const { question, imagePolicy, modelLabel, mode, resolved } = params;
  const image = normalizeImage(question.image);

  if (image && imagePolicy === "skip") return undefined;
  if (image && imagePolicy === "mark-unsupported") {
    return {
      model: modelLabel,
      response: [
        "Explanation: This HLE item includes an image, but this MMD adapter currently sends text-only model inputs.",
        "Answer: unsupported",
        "Confidence: 0%",
      ].join("\n"),
      usage: { cost_usd: 0, has_unknown_pricing: false },
      mmd: {
        skipped: true,
        reason: "image_unsupported",
        image,
      },
    };
  }

  const benchmarkQuestion = buildBenchmarkQuestion(question, image, imagePolicy);
  const result = await runDeliberation({
    question: benchmarkQuestion,
    models: resolved.models,
    provider: resolved.provider,
    coordinatorModelId: resolved.coordinatorModelId,
    mode,
    outputFormat: HLE_OUTPUT_FORMAT,
    costLimitUsd: params.costLimitUsd,
    fanoutOptions: compactFanoutOptions(params.fanoutOptions),
  });
  const formatted = coerceFormatterOutput(result.userOutput, result);

  return {
    model: modelLabel,
    response: toOfficialHleResponse(formatted),
    usage: usageFromResult(result),
    mmd: {
      run_id: result.runId,
      mode: result.mode,
      cost: result.cost,
      quorum: result.quorum,
      timings: result.timings,
      user_output_error: result.userOutputError,
      image_policy: image ? imagePolicy : undefined,
    },
  };
}

function buildBenchmarkQuestion(
  row: HleQuestion,
  image: string | undefined,
  imagePolicy: ImagePolicy
): string {
  const parts = [
    "Humanity's Last Exam benchmark item.",
    "",
    row.question,
    "",
    "Give the final answer as a closed-ended benchmark response. If this is multiple-choice, use the option label when possible. If this is short-answer, provide the exact concise answer.",
  ];

  if (image && imagePolicy === "append-url") {
    parts.push(
      "",
      `The original item includes an image URL, passed here as text only: ${image}`
    );
  }

  return parts.join("\n");
}

function coerceFormatterOutput(
  value: unknown,
  result: DeliberationResult
): HleFormatterOutput {
  if (isRecord(value)) {
    const explanation = value.explanation;
    const answer = value.answer;
    const confidence = value.confidence;
    if (
      typeof explanation === "string" &&
      explanation.trim() &&
      typeof answer === "string" &&
      answer.trim() &&
      typeof confidence === "number" &&
      Number.isFinite(confidence)
    ) {
      return {
        explanation: explanation.trim(),
        answer: answer.trim(),
        confidence: clampConfidence(confidence),
      };
    }
  }

  return {
    explanation: result.final.final_answer,
    answer: result.final.final_answer,
    confidence: confidenceFromConsensus(result.final.confidence_summary.consensus_strength),
  };
}

function toOfficialHleResponse(output: HleFormatterOutput): string {
  return [
    `Explanation: ${oneLine(output.explanation)}`,
    `Answer: ${oneLine(output.answer)}`,
    `Confidence: ${clampConfidence(output.confidence)}%`,
  ].join("\n");
}

function usageFromResult(result: DeliberationResult): Record<string, unknown> {
  return {
    cost_usd: result.cost.totalUsd,
    limit_usd: result.cost.limitUsd,
    has_unknown_pricing: result.cost.hasUnknownPricing,
  };
}

async function loadQuestions(inputPath: string): Promise<HleQuestion[]> {
  const raw = await readFile(inputPath, "utf8");
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const parsed =
    inputPath.endsWith(".jsonl") || inputPath.endsWith(".ndjson")
      ? trimmed.split(/\r?\n/).map((line) => JSON.parse(line))
      : JSON.parse(trimmed);
  const rows = normalizeRows(parsed);
  return rows.map(normalizeQuestion);
}

function normalizeRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.rows)) {
    return value.rows.map((row) => (isRecord(row) && "row" in row ? row.row : row));
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length && entries.every(([, column]) => Array.isArray(column))) {
      const length = (entries[0][1] as unknown[]).length;
      return Array.from({ length }, (_, index) =>
        Object.fromEntries(entries.map(([key, column]) => [key, (column as unknown[])[index]]))
      );
    }
  }
  throw new Error("input must be JSONL, an array of rows, a Hugging Face rows object, or a columnar object");
}

function normalizeQuestion(value: unknown): HleQuestion {
  if (!isRecord(value)) throw new Error("dataset row must be an object");
  const id = value.id;
  const question = value.question;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error(`dataset row is missing string id: ${JSON.stringify(value)}`);
  }
  if (typeof question !== "string" || !question.trim()) {
    throw new Error(`dataset row ${id} is missing string question`);
  }
  return {
    ...value,
    id: id.trim(),
    question,
    image:
      typeof value.image === "string" || value.image === null
        ? value.image
        : value.image === undefined
          ? ""
          : String(value.image),
  };
}

async function loadExistingPredictions(
  outputPath: string,
  fresh: boolean
): Promise<Record<string, HlePrediction>> {
  if (fresh || !existsSync(outputPath)) return {};
  const raw = await readFile(outputPath, "utf8");
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`existing predictions file must be a JSON object: ${outputPath}`);
  }
  return parsed as Record<string, HlePrediction>;
}

async function writePredictions(
  outputPath: string,
  predictions: Record<string, HlePrediction>
): Promise<void> {
  await writeFile(outputPath, `${JSON.stringify(predictions, null, 2)}\n`);
}

async function runQueue<T>(
  items: T[],
  workerCount: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(workerCount, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await task(item);
    }
  });
  await Promise.all(workers);
}

function loadDefaultEnvFiles(): void {
  loadEnvFile(path.join(repoRoot, ".env"));
  loadEnvFile(path.join(repoRoot, ".env.local"));
  loadEnvFile(path.join(repoRoot, "apps", "cli", ".env"));
  loadEnvFile(path.join(repoRoot, "apps", "cli", ".env.local"));
  loadEnvFile(path.join(adapterDir, ".env"));
  loadEnvFile(path.join(adapterDir, ".env.local"));
}

function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquoteEnvValue(rawValue.trim());
  }
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseMode(value: string | undefined): RunMode {
  if (value === undefined || value === "standard") return "standard";
  if (value === "quick" || value === "planning") return value;
  throw new Error(`unsupported --mode "${value}"; use standard, quick, or planning`);
}

function parseImagePolicy(value: string | undefined): ImagePolicy {
  if (value === undefined || value === "mark-unsupported") return "mark-unsupported";
  if (value === "skip" || value === "append-url") return value;
  throw new Error(
    `unsupported --image-policy "${value}"; use mark-unsupported, skip, or append-url`
  );
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalPositiveInt(
  value: string | undefined,
  name: string
): number | undefined {
  if (value === undefined) return undefined;
  return parsePositiveInt(value, name);
}

function parseOptionalNonNegativeInt(
  value: string | undefined,
  name: string
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseOptionalPositiveNumber(
  value: string | undefined,
  name: string
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive number`);
  }
  return parsed;
}

function compactFanoutOptions(options: {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}): { timeoutMs?: number; retries?: number; backoffMs?: number } | undefined {
  const compacted = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  );
  return Object.keys(compacted).length ? compacted : undefined;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeImage(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function confidenceFromConsensus(strength: "high" | "medium" | "low"): number {
  if (strength === "high") return 80;
  if (strength === "medium") return 55;
  return 30;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exitCode = 1;
});
