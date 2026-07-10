import { checkQuorum, type QuorumCheck } from "@mmd/protocol";
import type { ModelConfig } from "./provider.js";
import { withRetry, withTimeout } from "./resilience.js";

export interface FanoutSuccess<T> {
  config: ModelConfig;
  ok: true;
  value: T;
  latencyMs: number;
}

export interface FanoutFailure {
  config: ModelConfig;
  ok: false;
  error: Error;
  latencyMs: number;
}

export type FanoutResult<T> = FanoutSuccess<T> | FanoutFailure;

export interface FanoutOutcome<T> {
  results: FanoutResult<T>[];
  succeeded: FanoutSuccess<T>[];
  quorum: QuorumCheck;
}

export interface FanoutOptions {
  timeoutMs: number;
  retries: number;
  backoffMs: number;
  quorumRatio?: number;
  shouldRetry?: (error: unknown) => boolean;
  /** Fires the instant each model's call settles (success or failure), rather
   * than waiting for the whole Promise.all — lets callers surface per-model
   * progress within a phase instead of only at phase boundaries. */
  onSettled?: (result: FanoutResult<unknown>, index: number, total: number) => void;
}

export interface FanoutAttemptContext {
  attempt: number;
  signal: AbortSignal;
}

/**
 * Calls `call` for every model config in parallel. A single model's failure
 * (timeout, error, all retries exhausted) never rejects the whole fan-out —
 * per M0 risk #4, the caller decides what to do based on `quorum.met` /
 * `quorum.partial` instead of the promise rejecting outright.
 */
export async function fanOutWithQuorum<T>(
  configs: ModelConfig[],
  call: (config: ModelConfig, context?: FanoutAttemptContext) => Promise<T>,
  opts: FanoutOptions
): Promise<FanoutOutcome<T>> {
  const total = configs.length;
  const results = await Promise.all(
    configs.map(async (config, index): Promise<FanoutResult<T>> => {
      const t0 = Date.now();
      try {
        const value = await withRetry(
          (attempt) => {
            const controller = new AbortController();
            return withTimeout(
              call(config, { attempt, signal: controller.signal }),
              opts.timeoutMs,
              config.id,
              () => controller.abort()
            );
          },
          {
            retries: opts.retries,
            backoffMs: opts.backoffMs,
            shouldRetry:
              opts.shouldRetry ??
              ((error) =>
                !(
                  error &&
                  typeof error === "object" &&
                  "retryable" in error &&
                  (error as { retryable?: boolean }).retryable === false
                )),
          }
        );
        const result: FanoutResult<T> = {
          config,
          ok: true,
          value,
          latencyMs: Date.now() - t0,
        };
        opts.onSettled?.(result as FanoutResult<unknown>, index, total);
        return result;
      } catch (err) {
        const result: FanoutResult<T> = {
          config,
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
          latencyMs: Date.now() - t0,
        };
        opts.onSettled?.(result as FanoutResult<unknown>, index, total);
        return result;
      }
    })
  );

  const succeeded = results.filter(
    (r): r is FanoutSuccess<T> => r.ok
  );
  const quorum = checkQuorum(succeeded.length, configs.length, opts.quorumRatio);

  return { results, succeeded, quorum };
}
