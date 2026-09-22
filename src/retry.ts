export interface RetryOptions {
  attempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetry: (error: unknown, attempt: number) => boolean;
  getDelayMs?: (error: unknown, attempt: number, exponentialDelayMs: number) => number | null;
  jitterRatio?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export async function withRetry<T>(run: () => Promise<T>, options: RetryOptions): Promise<T> {
  let attempt = 0;
  let delayMs = options.initialDelayMs;

  for (;;) {
    attempt += 1;
    try {
      return await run();
    } catch (error) {
      if (attempt >= options.attempts || !options.shouldRetry(error, attempt)) {
        throw error;
      }

      const overrideDelayMs = options.getDelayMs?.(error, attempt, delayMs);
      const baseDelayMs = overrideDelayMs === null || overrideDelayMs === undefined ? delayMs : overrideDelayMs;
      const jitterRatio = Math.max(0, options.jitterRatio ?? 0);
      const jitter = jitterRatio > 0 ? baseDelayMs * jitterRatio * Math.random() : 0;
      await delay(Math.max(0, Math.round(baseDelayMs + jitter)));
      delayMs = Math.min(options.maxDelayMs, delayMs * 2);
    }
  }
}
