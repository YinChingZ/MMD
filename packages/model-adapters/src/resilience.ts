export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  onTimeout?: () => void
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => {
        onTimeout?.();
        reject(new Error(`timeout after ${timeoutMs}ms: ${label}`));
      },
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export interface RetryOptions {
  retries: number;
  backoffMs: number;
  shouldRetry?: (error: unknown) => boolean;
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < opts.retries && (opts.shouldRetry?.(err) ?? true)) {
        await sleep(opts.backoffMs * (attempt + 1));
      } else {
        break;
      }
    }
  }
  throw lastError;
}
