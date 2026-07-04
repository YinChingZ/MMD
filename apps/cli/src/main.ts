import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  MockProvider,
  OpenAICompatibleProvider,
  RoutingProvider,
  type ModelConfig,
  type ModelProvider,
} from "@mmd/model-adapters";
import { runDeliberation } from "./orchestrator.js";
import { toMarkdown } from "./format.js";
import { loadEnvFile } from "./env.js";
import { loadModelsConfig } from "./models-config.js";

loadEnvFile(".env");
loadEnvFile(".env.local");

const { values } = parseArgs({
  options: {
    question: { type: "string", short: "q" },
    models: { type: "string", short: "m" },
    mode: { type: "string" },
    "fail-models": { type: "string" },
    provider: { type: "string" },
    config: { type: "string", short: "c" },
    out: { type: "string", short: "o" },
  },
});

const question =
  values.question ??
  "Should a small team adopt a monorepo for a new multi-package TypeScript project?";
const mode =
  values.mode === "quick" ? "quick" : values.mode === "planning" ? "planning" : "standard";

const DEFAULT_CONFIG_PATH = "./models.config.json";
const configPath = values.config ?? DEFAULT_CONFIG_PATH;
const useRealProviders = values.provider !== "mock" && existsSync(configPath);

let models: ModelConfig[];
let provider: ModelProvider;
let coordinatorModelId: string | undefined;

if (useRealProviders) {
  const config = loadModelsConfig(configPath);
  models = config.models.map((m) => ({ id: m.id, provider: "openai-compatible" }));
  coordinatorModelId = config.coordinatorModelId ?? config.models[0].id;
  const routes = new Map(
    config.models.map((m) => [
      m.id,
      {
        provider: new OpenAICompatibleProvider({
          baseUrl: m.baseUrl,
          apiKeyEnvVar: m.apiKeyEnvVar,
        }),
        apiModelId: m.modelId,
      },
    ])
  );
  provider = new RoutingProvider(routes);
  console.error(`Using models config: ${configPath} (${models.length} models)`);
} else {
  const modelIds = (values.models ?? "model_a,model_b,model_c")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  models = modelIds.map((id) => ({ id, provider: "mock" }));
  const failModels = new Set(
    (values["fail-models"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  provider = new MockProvider({ failModelIds: failModels });
  console.error(
    `Using MockProvider (no ${configPath} found, or --provider mock was passed) — no real API calls will be made.`
  );
}

const result = await runDeliberation({
  question,
  models,
  provider,
  mode,
  coordinatorModelId,
  onEvent: (event) => {
    const phase = event.phase ? ` (${event.phase})` : "";
    const eventData = event.data as
      | {
          failures?: { modelId: string; message: string }[];
          topicId?: string;
          step?: string;
        }
      | undefined;
    const topicLabel = eventData?.topicId ? ` [topic:${eventData.topicId}]` : "";
    const stepLabel = eventData?.step ? ` (${eventData.step})` : "";
    console.error(
      `[${event.timestamp}] ${event.type}${phase}${stepLabel}${topicLabel}`
    );
    for (const f of eventData?.failures ?? []) {
      console.error(`  - ${f.modelId} failed: ${f.message}`);
    }
  },
});

const outDir = values.out ?? "./out";
await mkdir(outDir, { recursive: true });
const jsonPath = path.join(outDir, `${result.runId}.json`);
const mdPath = path.join(outDir, `${result.runId}.md`);
const markdown = toMarkdown(result);

await writeFile(jsonPath, JSON.stringify(result, null, 2));
await writeFile(mdPath, markdown);

console.log(`Wrote ${jsonPath}`);
console.log(`Wrote ${mdPath}`);
console.log("");
console.log(markdown);
