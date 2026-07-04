import { existsSync, readFileSync } from "node:fs";

/**
 * Minimal .env loader (no dotenv dependency), same behavior as apps/cli's —
 * reads KEY=VALUE lines, skips blanks/comments, strips matching quotes, and
 * never overwrites a variable already set in the real environment.
 */
export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (isQuoted) value = value.slice(1, -1);
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export interface ApiEnv {
  port: number;
  databaseUrl: string;
}

export function loadApiEnv(): ApiEnv {
  const port = Number(process.env.PORT ?? "3000");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set — copy apps/api/.env.example to apps/api/.env and point it at a Postgres instance (see docker-compose.yml)."
    );
  }
  return { port, databaseUrl };
}
