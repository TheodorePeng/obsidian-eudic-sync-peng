interface DebouncedSettingsCommitterOptions<Settings extends object> {
  delayMs: number;
  commit: (partial: Partial<Settings>) => Promise<void> | void;
}

export class DebouncedSettingsCommitter<Settings extends object> {
  private pending: Partial<Settings> = {};
  private timer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private commitQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: DebouncedSettingsCommitterOptions<Settings>) {}

  schedule(partial: Partial<Settings>): void {
    Object.assign(this.pending, partial);
    if (this.timer !== null) {
      globalThis.clearTimeout(this.timer);
    }
    this.timer = globalThis.setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.delayMs);
  }

  flush(): Promise<void> {
    if (this.timer !== null) {
      globalThis.clearTimeout(this.timer);
      this.timer = null;
    }
    if (Object.keys(this.pending).length === 0) {
      return this.commitQueue;
    }

    const batch = this.pending;
    this.pending = {};
    this.commitQueue = this.commitQueue.then(() => this.options.commit(batch));
    return this.commitQueue;
  }
}
