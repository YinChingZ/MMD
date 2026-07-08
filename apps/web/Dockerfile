# Build from the repo root: docker build -f apps/web/Dockerfile .
#
# Every @mmd/* import in apps/web is `import type` (compile-time only — see
# docs/roadmap.md's M4/Turbopack note: this app
# fetches data from apps/api instead of importing orchestrator/protocol
# runtime values directly, since Turbopack can't bundle raw TS workspace
# source the way tsx/vitest can). So packages/* are only needed in the build
# stage for type-checking; nothing workspace-specific ends up in the
# `output: "standalone"` trace, confirmed by inspecting .next/standalone
# (no @mmd/* present) during M5.4.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm ci
# API_BASE_URL is resolved once, at `next build` time, into
# .next/routes-manifest.json's rewrite destination (Next.js does not
# re-evaluate rewrites() per request) — so unlike apps/api's environment
# variables, this one is a build-time argument, not a `docker run -e`
# runtime setting. Rebuild with a different --build-arg to point at a
# different API host.
ARG API_BASE_URL=http://localhost:3000
ENV API_BASE_URL=${API_BASE_URL}
RUN npm run build --workspace=apps/web

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
