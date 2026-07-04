import { existsSync, readFileSync } from "node:fs";

/**
 * Minimal .env loader (no dotenv dependency). Reads KEY=VALUE lines, skips
 * blanks/comments, strips matching quotes, and never overwrites a variable
 * already set in the real environment.
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
