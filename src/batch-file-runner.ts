export async function forEachIsolated<Item>(
  items: readonly Item[],
  run: (item: Item, index: number) => Promise<void> | void,
  onError: (item: Item, error: unknown, index: number) => Promise<void> | void,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  let sliceStartedAt = globalThis.performance?.now?.() ?? Date.now();
  for (let index = 0; index < items.length; index += 1) {
    if (isCancelled()) {
      return;
    }

    const now = globalThis.performance?.now?.() ?? Date.now();
    if (index > 0 && (index % 50 === 0 || now - sliceStartedAt >= 8)) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
      sliceStartedAt = globalThis.performance?.now?.() ?? Date.now();
      if (isCancelled()) {
        return;
      }
    }

    const item = items[index];
    try {
      await run(item, index);
    } catch (error) {
      await onError(item, error, index);
    }
  }
}
