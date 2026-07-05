# Build from the repo root: docker build -f apps/api/Dockerfile .
#
# This is an npm-workspaces monorepo — apps/api imports packages/protocol,
# model-adapters, prompts, and orchestrator by package name, resolved
# through npm's hoisted root node_modules symlinks (e.g.
# node_modules/@mmd/protocol -> ../packages/protocol). A single-package
# "copy dist + node_modules + package.json" Dockerfile doesn't work here:
# each package's package.json points "main"/"types" straight at its
# src/index.ts (a deliberate M5.1-era choice so vitest/tsx never depend on a
# possibly-stale dist — see multi-model-deliberation-dev-roadmap.md), so
# apps/api's compiled dist/main.js would try to `require` raw TypeScript
# under plain Node and fail immediately with ERR_MODULE_NOT_FOUND. The
# runtime stage below runs the same way `npm start` already does in
# dev/CI — via tsx, which transpiles both apps/api's own source and the
# workspace packages' source on the fly — rather than introducing a bundler
# or restructuring how the packages resolve.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npm ci
# Type-check gate only: the runtime stage never uses this dist output (it
# runs source via tsx — see above), so this step exists purely to fail the
# image build on a type error rather than ship one.
RUN npm run build --workspace=packages/protocol \
 && npm run build --workspace=packages/model-adapters \
 && npm run build --workspace=packages/prompts \
 && npm run build --workspace=packages/orchestrator \
 && npm run build --workspace=apps/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build /app/packages/protocol/src ./packages/protocol/src
COPY --from=build /app/packages/model-adapters/package.json ./packages/model-adapters/package.json
COPY --from=build /app/packages/model-adapters/src ./packages/model-adapters/src
COPY --from=build /app/packages/prompts/package.json ./packages/prompts/package.json
COPY --from=build /app/packages/prompts/src ./packages/prompts/src
COPY --from=build /app/packages/orchestrator/package.json ./packages/orchestrator/package.json
COPY --from=build /app/packages/orchestrator/src ./packages/orchestrator/src
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/src ./apps/api/src

WORKDIR /app/apps/api
EXPOSE 3000
# db:migrate is idempotent (tracks applied migrations in `_migrations`), so
# running it on every boot is safe and means a fresh deploy's first start
# doesn't need a separate manual migration step.
CMD ["sh", "-c", "npm run db:migrate && npm run start"]
