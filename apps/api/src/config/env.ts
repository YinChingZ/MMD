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

/**
 * Separate from loadApiEnv/ApiEnv on purpose — apps/db/migrate.ts only needs
 * databaseUrl and shouldn't be forced to have an encryption key configured
 * just to run a migration. Only main.ts (the actual server) calls this.
 */
export function loadEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set — generate one with `openssl rand -base64 32` and set it in apps/api/.env (see .env.example). It encrypts BYOK API keys that users opt into saving."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode (base64) to exactly 32 bytes for AES-256-GCM, got ${key.length} — generate one with \`openssl rand -base64 32\`.`
    );
  }
  return key;
}
