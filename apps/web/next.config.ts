import path from "node:path";
import type { NextConfig } from "next";

// M5.4: pins the monorepo root Next.js traces node_modules/workspace files
// from. Without this, Next.js falls back to guessing by walking up for the
// nearest lockfile — which picks the *wrong* root whenever this repo is
// checked out somewhere that happens to have another lockfile further up
// (e.g. this project's own git worktrees live nested inside the main repo's
// directory tree, which has its own root package-lock.json). Explicit is
// also just more correct for `output: "standalone"`'s file tracing than an
// inferred guess.
const repoRoot = path.join(__dirname, "..", "..");

// Rewrites make apps/web and apps/api appear same-origin to the browser in
// dev, avoiding CORS entirely (no allowlist, no preflight, no cross-origin
// EventSource quirks for the SSE run-events endpoint) — matches this
// project's bias against adding infra it doesn't need. If apps/web is ever
// deployed on an edge/serverless runtime that buffers rewritten responses,
// SSE may need a direct connection + real CORS at that point; not a concern
// for `next dev`/`next start`'s Node server.
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  // M5.4: a self-contained apps/web/.next/standalone/server.js + pruned
  // node_modules, so the runtime Docker image doesn't need the rest of the
  // npm workspace (or even a full `npm install`) copied in — every @mmd/*
  // import in this app is `import type` only (see
  // docs/roadmap.md's M4/Turbopack note), so nothing
  // workspace-specific ends up in the traced output.
  output: "standalone",
  turbopack: {
    root: repoRoot,
  },
  // Next's built-in gzip compression buffers proxied responses to build its
  // compression window, which silently breaks live delivery for the
  // run-events SSE stream (confirmed: with compression on, the rewritten
  // /api/runs/:id/events response arrives with content-encoding: gzip and no
  // bytes reach the client until the stream ends — fine for JSON endpoints,
  // fatal for a stream that's meant to push events as they happen).
  compress: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiBaseUrl}/api/:path*` }];
  },
};

export default nextConfig;
