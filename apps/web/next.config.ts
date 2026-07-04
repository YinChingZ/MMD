import type { NextConfig } from "next";

// Rewrites make apps/web and apps/api appear same-origin to the browser in
// dev, avoiding CORS entirely (no allowlist, no preflight, no cross-origin
// EventSource quirks for the SSE run-events endpoint) — matches this
// project's bias against adding infra it doesn't need. If apps/web is ever
// deployed on an edge/serverless runtime that buffers rewritten responses,
// SSE may need a direct connection + real CORS at that point; not a concern
// for `next dev`/`next start`'s Node server.
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:3000";

const nextConfig: NextConfig = {
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
