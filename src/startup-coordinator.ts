export interface StartupTask {
  label: string;
  run: () => Promise<void> | void;
}

interface StartupCoordinatorOptions {
  isUnloaded: () => boolean;
  measure: <T>(label: string, callback: () => T) => T;
  onError: (label: string, error: unknown) => void;
  afterTask?: () => void;
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

export class StartupCoordinator {
  private running = false;
  private completed = false;

  constructor(private readonly options: StartupCoordinatorOptions) {}

  async run(tasks: StartupTask[]): Promise<void> {
    if (this.running || this.completed || this.options.isUnloaded()) {
      return;
    }

    this.running = true;
    try {
      for (const task of tasks) {
        if (this.options.isUnloaded()) {
          return;
        }

        try {
          await this.options.measure(task.label, () => task.run());
        } catch (error) {
          this.options.onError(task.label, error);
        } finally {
          this.options.afterTask?.();
        }

        await yieldToUi();
      }

      this.completed = true;
    } finally {
      this.running = false;
    }
  }
}
