export interface RetryOptions {
  attempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  shouldRetry: (error: unknown, attempt: number) => boolean;
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

      await delay(delayMs);
      delayMs = Math.min(options.maxDelayMs, delayMs * 2);
    }
  }
}
