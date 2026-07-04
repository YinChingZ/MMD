import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { MockProvider, OpenAICompatibleProvider } from "@mmd/model-adapters";
import { runDeliberation } from "./orchestrator.js";
import { toMarkdown } from "./format.js";

const { values } = parseArgs({
  options: {
    question: { type: "string", short: "q" },
    models: { type: "string", short: "m" },
    mode: { type: "string" },
    "fail-models": { type: "string" },
    provider: { type: "string" },
    out: { type: "string", short: "o" },
  },
});

const question =
  values.question ??
  "Should a small team adopt a monorepo for a new multi-package TypeScript project?";
const modelIds = (values.models ?? "model_a,model_b,model_c")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const providerName = values.provider ?? "mock";
const models = modelIds.map((id) => ({ id, provider: providerName }));
const failModels = new Set(
  (values["fail-models"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);
const mode = values.mode === "quick" ? "quick" : "standard";

const provider =
  providerName === "openai"
    ? new OpenAICompatibleProvider()
    : new MockProvider({ failModelIds: failModels });

const result = await runDeliberation({
  question,
  models,
  provider,
  mode,
  onEvent: (event) => {
    const phase = event.phase ? ` (${event.phase})` : "";
    console.error(`[${event.timestamp}] ${event.type}${phase}`);
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
