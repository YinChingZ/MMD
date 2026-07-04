import { existsSync } from "node:fs";
import { buildApp } from "./app.js";
import { loadApiEnv, loadEncryptionKey, loadEnvFile } from "./config/env.js";
import { loadModelsConfig } from "./config/models-config.js";
import { buildProvider } from "./config/provider-factory.js";
import { createDb } from "./db/client.js";

loadEnvFile(".env");
loadEnvFile(".env.local");

const env = loadApiEnv();
const encryptionKey = loadEncryptionKey();
const db = createDb(env.databaseUrl);

const MODELS_CONFIG_PATH = "./models.config.json";
const modelsConfig = existsSync(MODELS_CONFIG_PATH)
  ? loadModelsConfig(MODELS_CONFIG_PATH)
  : undefined;
const resolvedProvider = buildProvider(modelsConfig);

if (resolvedProvider.isMock) {
  console.log(
    `No ${MODELS_CONFIG_PATH} found — using MockProvider, no real API calls will be made.`
  );
} else {
  console.log(
    `Using models config: ${MODELS_CONFIG_PATH} (${resolvedProvider.availableModelIds.length} models)`
  );
}

const app = buildApp({ db, resolvedProvider, encryptionKey });

app.listen({ port: env.port, host: "0.0.0.0" }, (err) => {
  if (err) {
    app.log.error(err);
    process.exitCode = 1;
  }
});
