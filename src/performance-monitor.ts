const STORAGE_KEY = "eudic-sync:perf";

function isEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export class PerformanceMonitor {
  measure<T>(label: string, callback: () => T): T {
    if (!isEnabled()) {
      return callback();
    }

    const startedAt = now();
    try {
      const result = callback();
      if (result instanceof Promise) {
        return result.finally(() => this.log(label, startedAt)) as T;
      }

      this.log(label, startedAt);
      return result;
    } catch (error) {
      this.log(label, startedAt);
      throw error;
    }
  }

  log(label: string, startedAt: number): void {
    if (!isEnabled()) {
      return;
    }

    const elapsedMs = Math.round((now() - startedAt) * 10) / 10;
    console.debug(`[eudic-sync:perf] ${label}: ${elapsedMs}ms`);
  }
}
