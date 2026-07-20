import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ExperimentManifestSchema,
  getProviderBaseUrl,
  getProviderDisplayName,
  resolveGovernance,
  type Governance,
} from "@mmd/protocol";
import { validateOutputFormatSchema } from "@mmd/model-adapters";
import type { AppDeps } from "../app.js";
import { buildRunProvider } from "../config/provider-factory.js";
import { resolveWorkspace } from "../middleware/workspace.js";
import { getConversation } from "../repositories/conversations-repo.js";
import {
  getOrCreateShareToken,
  getRun,
  getRunImages,
  revokeShareToken,
} from "../repositories/runs-repo.js";
import { getResult } from "../repositories/results-repo.js";
import { getTraceSnapshot } from "../repositories/traces-repo.js";
import {
  getDecryptedApiKey,
  saveApiKey,
} from "../repositories/workspace-api-keys-repo.js";

const PricingOverride = z.object({
  inputPerMillion: z.number().positive(),
  outputPerMillion: z.number().positive(),
});

const ByokModelEntry = z
  .object({
    providerId: z.string().min(1).optional(),
    modelId: z.string().min(1).optional(),
    // Exactly one of these: a fresh key, or a reference to one the caller
    // previously opted to save — the browser never needs to hold the
    // plaintext again to reuse a saved key.
    apiKey: z.string().min(1).optional(),
    savedKeyId: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    // Opt-in, per model — not a single flag for the whole request, since a
    // caller might want to remember an OpenRouter key but not a one-off key
    // for another provider in the same run. Only meaningful with a fresh apiKey.
    save: z.boolean().optional(),
    // M5.1 follow-up: a caller-supplied $/1M-token rate — overrides
    // @mmd/protocol's built-in approximate table (never a provider's own
    // real reported cost, e.g. OpenRouter's), and is the only way to price
    // a provider we don't otherwise recognize at all. When savedKeyId is
    // used instead of a fresh apiKey, this overrides that saved key's own
    // persisted pricing (if any) for this run only, without changing what's
    // stored — see the `save: true` handling below for updating the stored
    // rate itself.
    pricing: PricingOverride.optional(),
  })
  .refine((m) => Boolean(m.apiKey) !== Boolean(m.savedKeyId), {
    message: "each byokModels entry needs exactly one of apiKey or savedKeyId",
  })
  .refine((m) => !m.apiKey || (m.providerId && m.modelId), {
    message: "providerId and modelId are required when supplying a fresh apiKey",
  });

// M5.1 cost circuit breaker: applied whenever a request doesn't supply its
// own costLimitUsd, so a run is never unprotected just because a caller
// forgot to think about cost — see docs/roadmap.md's
// M5.1 section for why $5 was chosen (standard/quick real-model runs cost
// cents to ~$1; planning mode's up-to-8-parallel-topics case needs more
// headroom, which callers running a large planning run should raise
// explicitly via costLimitUsd rather than relying on the default).
const DEFAULT_COST_LIMIT_USD = 5;
/** M6.5 upload policy, mirrored by apps/web before a request is sent. */
export const MAX_INPUT_IMAGES = 3;
export const MAX_INPUT_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_INPUT_IMAGE_BYTES = 12 * 1024 * 1024;
// 12 MiB of source bytes becomes 16 MiB after base64, plus JSON/request
// framing. Keep this route-local rather than raising Fastify's global limit.
export const CREATE_RUN_BODY_LIMIT = 18 * 1024 * 1024;

const InputImageBody = z.object({ dataUrl: z.string().min(1) });

export type InputImageBody = z.infer<typeof InputImageBody>;

/**
 * Validates exactly the compact data-URL subset accepted by M6.5. Buffer's
 * base64 decoder is intentionally permissive, so canonical round-tripping is
 * required to reject malformed payloads instead of silently changing them.
 */
export function validateInputImages(
  images: InputImageBody[]
): { ok: true } | { ok: false; error: string } {
  if (images.length > MAX_INPUT_IMAGES) {
    return { ok: false, error: `at most ${MAX_INPUT_IMAGES} images are allowed` };
  }

  let totalBytes = 0;
  for (const [index, image] of images.entries()) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      image.dataUrl
    );
    if (!match) {
      return {
        ok: false,
        error: `images[${index}] must be a base64 JPEG, PNG, or WebP data URL`,
      };
    }
    const encoded = match[2];
    if (encoded.length % 4 !== 0) {
      return { ok: false, error: `images[${index}] has invalid base64 padding` };
    }
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length === 0 || bytes.toString("base64") !== encoded) {
      return { ok: false, error: `images[${index}] has invalid base64 data` };
    }
    if (bytes.length > MAX_INPUT_IMAGE_BYTES) {
      return {
        ok: false,
        error: `images[${index}] exceeds the ${MAX_INPUT_IMAGE_BYTES / 1024 / 1024}MB limit`,
      };
    }
    totalBytes += bytes.length;
  }

  if (totalBytes > MAX_TOTAL_INPUT_IMAGE_BYTES) {
    return {
      ok: false,
      error: `images exceed the ${MAX_TOTAL_INPUT_IMAGE_BYTES / 1024 / 1024}MB total limit`,
    };
  }
  return { ok: true };
}

const CreateRunBody = z.object({
  question: z.string().min(1),
  mode: z.enum(["standard", "quick", "planning"]).optional(),
  governance: z.enum(["centralized", "distributed"]).optional(),
  experimentManifest: ExperimentManifestSchema.optional(),
  // Legacy path: pick a subset of the server-side models.config.json registry.
  // Omitted entirely (and no byokModels either) keeps the pre-BYOK default of
  // using every registry model — see selectedLegacyIds below.
  modelIds: z.array(z.string().min(1)).min(1).optional(),
  // BYOK path: client supplies its own whitelisted-provider credentials.
  byokModels: z.array(ByokModelEntry).min(1).optional(),
  // Hard USD cap on the run's total cost, checked before each phase starts.
  // Omitted entirely (not just falsy) triggers DEFAULT_COST_LIMIT_USD — there
  // is no way to request "no limit at all" from the HTTP API.
  costLimitUsd: z.number().positive().optional(),
  // M6.1: optional caller-supplied JSON Schema. When set, the deliberation's
  // normal FinalAnswer/PlanDocument gets reformatted into this shape as an
  // extra, additive step — schema.schema itself gets a second pass through
  // validateOutputFormatSchema below (the v1-subset/depth/size check), since
  // zod here only confirms the request's own shape, not the schema's content.
  outputFormat: z
    .object({
      type: z.literal("json_schema"),
      name: z.string().min(1).optional(),
      schema: z.record(z.unknown()),
      instructions: z.string().optional(),
    })
    .optional(),
  images: z.array(InputImageBody).max(MAX_INPUT_IMAGES).optional(),
  // M6.6: one opt-in switch enables direct OpenAI Responses or OpenRouter
  // server-tool search in both propose and critique. The compatibility guard
  // below keeps this strictly BYOK and prevents a partial mixed-provider run.
  webSearch: z.boolean().optional(),
});

export async function runsRoutes(
  fastify: FastifyInstance,
  deps: AppDeps
): Promise<void> {
  fastify.addHook("onRequest", async (request, reply) => {
    request.workspaceId = await resolveWorkspace(deps.db, request, reply);
  });

  fastify.post<{ Params: { id: string } }>(
    "/api/conversations/:id/runs",
    // M5.3: cheap DB-writes-and-concurrent-runs guard, independent of the
    // M5.1 cost circuit breaker (that one protects the caller's own BYOK
    // budget; this one protects the platform from a single workspace
    // hammering run creation).
    {
      bodyLimit: CREATE_RUN_BODY_LIMIT,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const conversation = await getConversation(deps.db, request.params.id);
      if (!conversation || conversation.workspaceId !== request.workspaceId) {
        return reply.code(404).send({ error: "conversation not found" });
      }

      const parsed = CreateRunBody.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.message });
      }

      const {
        question,
        mode = "standard",
        governance,
        experimentManifest,
        modelIds,
        byokModels = [],
        costLimitUsd = DEFAULT_COST_LIMIT_USD,
        outputFormat,
        images = [],
        webSearch = false,
      } = parsed.data;

      let resolvedGovernance: Governance;
      try {
        resolvedGovernance = resolveGovernance(mode, governance, experimentManifest);
      } catch (error) {
        const protocolError = error as Error & { code?: string };
        return reply.code(400).send({
          code: protocolError.code ?? "invalid_governance",
          error: protocolError.message,
        });
      }

      const imagesCheck = validateInputImages(images);
      if (!imagesCheck.ok) {
        return reply.code(400).send({ error: `invalid images: ${imagesCheck.error}` });
      }

      if (outputFormat) {
        const schemaCheck = validateOutputFormatSchema(outputFormat.schema);
        if (!schemaCheck.ok) {
          return reply
            .code(400)
            .send({ error: `invalid outputFormat.schema: ${schemaCheck.error}` });
        }
      }

      const { availableModelIds } = deps.resolvedProvider;

      // Omitting modelIds keeps the pre-BYOK default of "use every registry
      // model" — but only when the client isn't already supplying byokModels,
      // otherwise a BYOK-only request would silently pull in the whole
      // legacy roster too.
      const selectedLegacyIds =
        modelIds ?? (byokModels.length > 0 ? [] : availableModelIds);
      const unknownIds = selectedLegacyIds.filter(
        (id) => !availableModelIds.includes(id)
      );
      if (unknownIds.length) {
        return reply
          .code(400)
          .send({ error: `unknown model id(s): ${unknownIds.join(", ")}` });
      }

      // Resolve each entry to a concrete {providerId, modelId, apiKey} —
      // either straight from the request or, for a savedKeyId reference,
      // decrypted from this workspace's saved keys — so the rest of the
      // pipeline doesn't need to care which path a given model came from.
      const resolvedByokModels: Array<{
        providerId: string;
        modelId: string;
        apiKey: string;
        label?: string;
        save?: boolean;
        pricing?: { inputPerMillion: number; outputPerMillion: number };
      }> = [];
      for (const m of byokModels) {
        if (m.savedKeyId) {
          const saved = await getDecryptedApiKey(deps.db, deps.encryptionKey, {
            workspaceId: request.workspaceId,
            id: m.savedKeyId,
          });
          if (!saved) {
            return reply
              .code(400)
              .send({ error: `unknown saved key id: ${m.savedKeyId}` });
          }
          resolvedByokModels.push({
            providerId: saved.providerId,
            modelId: saved.modelId,
            apiKey: saved.apiKey,
            label: m.label ?? saved.label ?? undefined,
            // Request-level override wins over the saved default for this run only.
            pricing: m.pricing ?? saved.pricing,
          });
        } else {
          resolvedByokModels.push({
            providerId: m.providerId!,
            modelId: m.modelId!,
            apiKey: m.apiKey!,
            label: m.label,
            save: m.save,
            pricing: m.pricing,
          });
        }
      }

      const unknownProviders = resolvedByokModels
        .map((m) => m.providerId)
        .filter((id) => !getProviderBaseUrl(id));
      if (unknownProviders.length) {
        return reply.code(400).send({
          error: `unsupported provider id(s): ${unknownProviders.join(", ")}`,
        });
      }

      let runProvider;
      try {
        runProvider = buildRunProvider({
          legacy: deps.resolvedProvider,
          selectedLegacyIds,
          byokModels: resolvedByokModels.map((m) => ({
            label: m.label ?? `${m.providerId}:${m.modelId}`,
            baseUrl: getProviderBaseUrl(m.providerId)!,
            apiKey: m.apiKey,
            modelId: m.modelId,
            providerLabel: getProviderDisplayName(m.providerId) ?? m.providerId,
            providerId: m.providerId,
            pricing: m.pricing,
          })),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }

      if (webSearch && !runProvider.supportsWebSearch) {
        return reply.code(400).send({
          error: "webSearch requires OpenAI-only or OpenRouter-only BYOK models, with no server-configured or mixed-provider models",
        });
      }

      let executionModels = runProvider.models;
      let coordinatorModelId = runProvider.coordinatorModelId;
      if (mode === "quick") {
        const explicitPanel = modelIds !== undefined || byokModels.length > 0;
        if (explicitPanel && executionModels.length !== 2) {
          return reply.code(400).send({
            code: "quick_requires_two_models",
            error: "quick mode requires exactly two distinct models",
          });
        }
        if (!explicitPanel) {
          const coordinator = executionModels.find(
            (model) => model.id === coordinatorModelId
          ) ?? executionModels[0];
          const peer = executionModels.find((model) => model.id !== coordinator?.id);
          if (!coordinator || !peer) {
            return reply.code(400).send({
              code: "quick_requires_two_models",
              error: "quick mode could not select two distinct default models",
            });
          }
          executionModels = [coordinator, peer];
          coordinatorModelId = coordinator.id;
        }
      }

      for (const m of resolvedByokModels) {
        if (!m.save) continue;
        await saveApiKey(deps.db, deps.encryptionKey, {
          workspaceId: request.workspaceId,
          providerId: m.providerId,
          modelId: m.modelId,
          apiKey: m.apiKey,
          label: m.label,
          pricing: m.pricing,
        });
      }

      const { runId } = await deps.runService.start({
        conversationId: request.params.id,
        workspaceId: request.workspaceId,
        question,
        images,
        webSearch,
        mode,
        governance: resolvedGovernance,
        experimentManifest,
        models: executionModels,
        provider: runProvider.provider,
        coordinatorModelId,
        costLimitUsd,
        outputFormat,
      });

      return reply.code(201).send({ runId, status: "running" });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/runs/:id",
    async (request, reply) => {
      const run = await getRun(deps.db, request.params.id);
      if (!run || run.workspaceId !== request.workspaceId) {
        return reply.code(404).send({ error: "run not found" });
      }
      return reply.send(run);
    }
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/runs/:id/result",
    async (request, reply) => {
      const run = await getRun(deps.db, request.params.id);
      if (!run || run.workspaceId !== request.workspaceId) {
        return reply.code(404).send({ error: "run not found" });
      }
      if (run.status === "running") {
        return reply.code(409).send({ status: "running" });
      }
      if (run.status === "failed") {
        return reply.code(422).send({ status: "failed", error: run.error });
      }
      const result = await getResult(deps.db, request.params.id);
      if (!result) {
        return reply.code(404).send({ error: "result not found" });
      }
      return reply.send({
        runId: run.id,
        question: run.question,
        mode: run.mode,
        governance: run.governance,
        status: run.status,
        ...result,
      });
    }
  );

  // Trace snapshots are independent of the terminal result row, so callers
  // can inspect preserved artifacts for running and failed executions too.
  fastify.get<{ Params: { id: string } }>(
    "/api/runs/:id/trace",
    async (request, reply) => {
      const run = await getRun(deps.db, request.params.id);
      if (!run || run.workspaceId !== request.workspaceId) {
        return reply.code(404).send({ error: "run not found" });
      }
      const trace = await getTraceSnapshot(deps.db, request.params.id);
      if (!trace) {
        return reply.code(404).send({ error: "trace not found" });
      }
      return reply.send(trace);
    }
  );

  // M6.5 follow-up: lets the owning workspace view the images it attached to
  // a run after the fact. Deliberately a separate, call-once endpoint rather
  // than projected onto GET /run — see getRunImages()'s comment for why.
  fastify.get<{ Params: { id: string } }>(
    "/api/runs/:id/images",
    async (request, reply) => {
      const record = await getRunImages(deps.db, request.params.id);
      if (!record || record.workspaceId !== request.workspaceId) {
        return reply.code(404).send({ error: "run not found" });
      }
      return reply.send({ images: record.images });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    "/api/runs/:id/share",
    async (request, reply) => {
      const run = await getRun(deps.db, request.params.id);
      if (!run || run.workspaceId !== request.workspaceId) {
        return reply.code(404).send({ error: "run not found" });
      }
      if (run.status === "running") {
        return reply.code(409).send({ status: "running" });
      }
      if (run.status === "failed") {
        return reply.code(422).send({ status: "failed", error: run.error });
      }
      const token = await getOrCreateShareToken(deps.db, run.id);
      return reply.send({ token });
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/runs/:id/share",
    async (request, reply) => {
      const run = await getRun(deps.db, request.params.id);
      if (!run || run.workspaceId !== request.workspaceId) {
        return reply.code(404).send({ error: "run not found" });
      }
      await revokeShareToken(deps.db, run.id);
      return reply.code(204).send();
    }
  );
}
