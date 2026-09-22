import type { TFile } from "obsidian";
import type { ReferenceGraphUpdate } from "./reference-index-service";

export type ManagedIndexState = "cold" | "building" | "ready" | "failed";
export type ManagedIndexRebuildReason =
  | "layout-ready"
  | "settings-scope-change"
  | "manual"
  | "self-heal"
  | "ensure-ready";

export interface ManagedIndexCounts {
  wordCount: number;
  referenceCount: number;
}

export interface ManagedIndexSnapshot extends ManagedIndexCounts {
  generation: number;
  builtAt: number;
  buildDurationMs: number;
}

export interface ManagedIndexDiagnostics {
  state: ManagedIndexState;
  generation: number;
  queuedEventCount: number;
  snapshot: ManagedIndexSnapshot | null;
  lastError: string | null;
}

interface ManagedIndexCoordinatorOptions {
  rebuildRegistry: () => void;
  getRegistryCounts: () => ManagedIndexCounts;
  getVaultCounts: () => ManagedIndexCounts;
  rebuildGraph: (shouldCommit: () => boolean) => Promise<boolean>;
  updateWord: (file: TFile, markdown: string) => Promise<ReferenceGraphUpdate>;
  removeWord: (path: string) => string[];
  now?: () => number;
}

interface PendingEvent<Result> {
  run: () => Promise<Result> | Result;
  resolve: (result: Result) => void;
  reject: (error: unknown) => void;
}

const CANCELLED_MESSAGE = "Managed index coordinator was cancelled.";

export class ManagedIndexCoordinator {
  private state: ManagedIndexState = "cold";
  private generation = 0;
  private cancelled = false;
  private snapshot: ManagedIndexSnapshot | null = null;
  private lastError: string | null = null;
  private activeBuild: Promise<ManagedIndexSnapshot> | null = null;
  private readonly pendingEvents: PendingEvent<unknown>[] = [];

  constructor(private readonly options: ManagedIndexCoordinatorOptions) {}

  ensureReady(): Promise<ManagedIndexSnapshot> {
    if (this.state === "ready" && this.snapshot) {
      return Promise.resolve(this.snapshot);
    }
    if (this.state === "building" && this.activeBuild) {
      return this.activeBuild;
    }
    return this.rebuild("ensure-ready");
  }

  rebuild(_reason: ManagedIndexRebuildReason): Promise<ManagedIndexSnapshot> {
    this.cancelled = false;
    const generation = ++this.generation;
    this.state = "building";
    this.lastError = null;

    let operation!: Promise<ManagedIndexSnapshot>;
    operation = this.performRebuild(generation).then(async (nextSnapshot) => {
      if (nextSnapshot) {
        return nextSnapshot;
      }

      const latestBuild = this.activeBuild;
      if (latestBuild && latestBuild !== operation) {
        return latestBuild;
      }
      if (this.snapshot) {
        return this.snapshot;
      }
      throw new Error("Managed index rebuild was superseded before a snapshot was ready.");
    });
    this.activeBuild = operation;
    return operation;
  }

  updateWord(file: TFile, markdown: string): Promise<ReferenceGraphUpdate> {
    return this.runOrQueue(() => this.options.updateWord(file, markdown));
  }

  removeWord(path: string): Promise<string[]> {
    return this.runOrQueue(() => this.options.removeWord(path));
  }

  cancel(): void {
    this.cancelled = true;
    this.generation += 1;
    this.state = "cold";
    this.activeBuild = null;
    const error = new Error(CANCELLED_MESSAGE);
    for (const event of this.pendingEvents.splice(0)) {
      event.reject(error);
    }
  }

  getDiagnostics(): ManagedIndexDiagnostics {
    return {
      state: this.state,
      generation: this.generation,
      queuedEventCount: this.pendingEvents.length,
      snapshot: this.snapshot ? { ...this.snapshot } : null,
      lastError: this.lastError,
    };
  }

  private async performRebuild(generation: number): Promise<ManagedIndexSnapshot | null> {
    const startedAt = this.options.now?.() ?? Date.now();
    const isCurrent = (): boolean => !this.cancelled && generation === this.generation;
    try {
      this.options.rebuildRegistry();
      const registryCounts = this.options.getRegistryCounts();
      const vaultCounts = this.options.getVaultCounts();
      if (
        registryCounts.wordCount !== vaultCounts.wordCount ||
        registryCounts.referenceCount !== vaultCounts.referenceCount
      ) {
        this.options.rebuildRegistry();
      }

      const committed = await this.options.rebuildGraph(isCurrent);
      if (!committed || !isCurrent()) {
        return null;
      }

      await this.replayPendingEvents(generation);
      if (!isCurrent()) {
        return null;
      }

      const counts = this.options.getRegistryCounts();
      const expectedCounts = this.options.getVaultCounts();
      if (
        counts.wordCount !== expectedCounts.wordCount ||
        counts.referenceCount !== expectedCounts.referenceCount
      ) {
        throw new Error(
          `Managed registry count mismatch (registry ${counts.wordCount}/${counts.referenceCount}, vault ${expectedCounts.wordCount}/${expectedCounts.referenceCount}).`,
        );
      }

      const snapshot: ManagedIndexSnapshot = {
        ...counts,
        generation,
        builtAt: this.options.now?.() ?? Date.now(),
        buildDurationMs: Math.max(0, (this.options.now?.() ?? Date.now()) - startedAt),
      };
      this.snapshot = snapshot;
      this.state = "ready";
      return snapshot;
    } catch (error) {
      if (!isCurrent()) {
        return null;
      }
      this.state = "failed";
      this.lastError = error instanceof Error ? error.message : String(error);
      for (const event of this.pendingEvents.splice(0)) {
        event.reject(error);
      }
      throw error;
    }
  }

  private runOrQueue<Result>(run: () => Promise<Result> | Result): Promise<Result> {
    if (this.cancelled) {
      return Promise.reject(new Error(CANCELLED_MESSAGE));
    }
    if (this.state !== "building") {
      return Promise.resolve().then(run);
    }

    return new Promise<Result>((resolve, reject) => {
      this.pendingEvents.push({
        run,
        resolve: resolve as (result: unknown) => void,
        reject,
      });
    });
  }

  private async replayPendingEvents(generation: number): Promise<void> {
    while (!this.cancelled && generation === this.generation && this.pendingEvents.length > 0) {
      const event = this.pendingEvents.shift();
      if (!event) {
        continue;
      }
      try {
        event.resolve(await event.run());
      } catch (error) {
        event.reject(error);
      }
    }
  }
}
