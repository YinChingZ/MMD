import type { Kysely } from "kysely";
import { getBudget, makeRunId, type RunMode } from "@mmd/protocol";
import type { ModelConfig, ModelProvider } from "@mmd/model-adapters";
import { runDeliberation, type RunEvent } from "@mmd/orchestrator";
import type { Database } from "../db/client.js";
import { appendRunEvent } from "../repositories/events-repo.js";
import {
  createRun,
  markRunCompleted,
  markRunFailed,
} from "../repositories/runs-repo.js";
import { saveResult } from "../repositories/results-repo.js";
import type { RunBroadcaster } from "../sse/broadcaster.js";

export interface StartRunParams {
  conversationId: string;
  question: string;
  mode: RunMode;
  models: ModelConfig[];
  provider: ModelProvider;
  coordinatorModelId?: string;
}

const TERMINAL_TYPES = new Set(["run_completed", "run_failed"]);

export class RunService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly broadcaster: RunBroadcaster
  ) {}

  /**
   * Persists the `runs` row synchronously, then starts deliberation in the
   * background and returns immediately — the route handler responds 201
   * without waiting for the run to finish. Errors from the background
   * execution are always caught here and turned into a `status="failed"`
   * row + persisted run_failed event, never an unhandled rejection (M0's
   * "one model's failure shouldn't sink the run" principle, applied one
   * level up to "the whole run shouldn't crash the process").
   */
  async start(params: StartRunParams): Promise<{ runId: string }> {
    const runId = makeRunId();
    const budget = getBudget(params.mode);

    await createRun(this.db, {
      id: runId,
      conversationId: params.conversationId,
      question: params.question,
      mode: params.mode,
      modelConfig: params.models,
      budget,
    });

    let seq = 0;
    let eventChain: Promise<void> = Promise.resolve();
    let resolveSettledGate!: () => void;
    const settledGate = new Promise<void>((resolve) => {
      resolveSettledGate = resolve;
    });

    const onEvent = (event: RunEvent) => {
      seq += 1;
      const currentSeq = seq;
      const isTerminal = TERMINAL_TYPES.has(event.type);
      eventChain = eventChain
        .then(async () => {
          const persisted = await appendRunEvent(this.db, {
            runId,
            seq: currentSeq,
            event,
          });
          // Terminal events wait until the result/status row is actually
          // committed before broadcasting — otherwise an SSE client could
          // see "run_completed" and immediately GET /result before it exists.
          if (isTerminal) await settledGate;
          this.broadcaster.publish(runId, persisted);
        })
        .catch((err) => {
          console.error(
            `run ${runId}: failed to persist/broadcast event`,
            err
          );
        });
    };

    runDeliberation({
      question: params.question,
      models: params.models,
      provider: params.provider,
      mode: params.mode,
      coordinatorModelId: params.coordinatorModelId,
      runId,
      onEvent,
    })
      .then(async (result) => {
        await saveResult(this.db, result);
        await markRunCompleted(this.db, runId);
      })
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        await markRunFailed(this.db, runId, message).catch((dbErr) => {
          console.error(`run ${runId}: failed to mark as failed`, dbErr);
        });
      })
      .finally(() => resolveSettledGate());

    return { runId };
  }
}
