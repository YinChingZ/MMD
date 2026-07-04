import { checkQuorum, type QuorumCheck } from "@mmd/protocol";
import type { ModelConfig } from "./provider.js";
import { withRetry, withTimeout } from "./resilience.js";

export interface FanoutSuccess<T> {
  config: ModelConfig;
  ok: true;
  value: T;
}

export interface FanoutFailure {
  config: ModelConfig;
  ok: false;
  error: Error;
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
}

/**
 * Calls `call` for every model config in parallel. A single model's failure
 * (timeout, error, all retries exhausted) never rejects the whole fan-out —
 * per M0 risk #4, the caller decides what to do based on `quorum.met` /
 * `quorum.partial` instead of the promise rejecting outright.
 */
export async function fanOutWithQuorum<T>(
  configs: ModelConfig[],
  call: (config: ModelConfig) => Promise<T>,
  opts: FanoutOptions
): Promise<FanoutOutcome<T>> {
  const results = await Promise.all(
    configs.map(async (config): Promise<FanoutResult<T>> => {
      try {
        const value = await withRetry(
          () => withTimeout(call(config), opts.timeoutMs, config.id),
          { retries: opts.retries, backoffMs: opts.backoffMs }
        );
        return { config, ok: true, value };
      } catch (err) {
        return {
          config,
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    })
  );

  const succeeded = results.filter(
    (r): r is FanoutSuccess<T> => r.ok
  );
  const quorum = checkQuorum(succeeded.length, configs.length, opts.quorumRatio);

  return { results, succeeded, quorum };
}
