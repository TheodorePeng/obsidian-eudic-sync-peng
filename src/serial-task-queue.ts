export class SerialTaskQueue<Key extends object> {
  private readonly tails = new WeakMap<Key, Promise<void>>();

  enqueue<Result>(key: Key, task: () => Promise<Result>): Promise<Result> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    return current;
  }
}
