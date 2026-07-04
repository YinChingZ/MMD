import Fastify, { type FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type { ResolvedProvider } from "./config/provider-factory.js";
import type { Database } from "./db/client.js";
import { conversationsRoutes } from "./routes/conversations.js";
import { eventsRoutes } from "./routes/events.js";
import { runsRoutes } from "./routes/runs.js";
import { RunBroadcaster } from "./sse/broadcaster.js";
import { RunService } from "./services/run-service.js";

export interface AppDeps {
  db: Kysely<Database>;
  broadcaster: RunBroadcaster;
  runService: RunService;
  resolvedProvider: ResolvedProvider;
}

export interface BuildAppParams {
  db: Kysely<Database>;
  resolvedProvider: ResolvedProvider;
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
  };

  const app = Fastify({ logger: params.logger ?? true });

  app.get("/health", async () => ({ ok: true }));
  app.register((instance) => conversationsRoutes(instance, deps));
  app.register((instance) => runsRoutes(instance, deps));
  app.register((instance) => eventsRoutes(instance, deps));

  return app;
}
