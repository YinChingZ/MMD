import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { ResolvedProvider } from "./config/provider-factory.js";
import type { Database } from "./db/client.js";
import { WORKSPACE_COOKIE_NAME } from "./middleware/workspace.js";
import { conversationsRoutes } from "./routes/conversations.js";
import { eventsRoutes } from "./routes/events.js";
import { modelsRoutes } from "./routes/models.js";
import { providersRoutes } from "./routes/providers.js";
import { runsRoutes } from "./routes/runs.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { RunBroadcaster } from "./sse/broadcaster.js";
import { RunService } from "./services/run-service.js";

export interface AppDeps {
  db: Kysely<Database>;
  broadcaster: RunBroadcaster;
  runService: RunService;
  resolvedProvider: ResolvedProvider;
  encryptionKey: Buffer;
}

export interface BuildAppParams {
  db: Kysely<Database>;
  resolvedProvider: ResolvedProvider;
  encryptionKey: Buffer;
  logger?: boolean;
}

export function buildApp(params: BuildAppParams): FastifyInstance {
  const broadcaster = new RunBroadcaster();
  const runService = new RunService(params.db, broadcaster);
  const deps: AppDeps = {
    db: params.db,
    broadcaster,
    runService,
    resolvedProvider: params.resolvedProvider,
    encryptionKey: params.encryptionKey,
  };

  const app = Fastify({ logger: params.logger ?? true });
  app.register(fastifyCookie);
  // M5.3: not applied globally (`global: false`) — only the run-creation
  // route opts in via its own `config.rateLimit` (see routes/runs.ts). Keyed
  // by the workspace cookie (already parsed by fastifyCookie above, so it's
  // available regardless of hook ordering vs. runsRoutes' own onRequest
  // hook) rather than IP, since a workspace is this project's stable visitor
  // identity — see middleware/workspace.ts.
  app.register(fastifyRateLimit, {
    global: false,
    keyGenerator: (request) =>
      request.cookies[WORKSPACE_COOKIE_NAME] ?? request.ip,
  });

  app.get("/health", async () => ({ ok: true }));
  app.register((instance) => conversationsRoutes(instance, deps));
  app.register((instance) => runsRoutes(instance, deps));
  app.register((instance) => eventsRoutes(instance, deps));
  app.register((instance) => modelsRoutes(instance, deps));
  app.register((instance) => providersRoutes(instance, deps));
  app.register((instance) => workspaceRoutes(instance, deps));

  return app;
}
