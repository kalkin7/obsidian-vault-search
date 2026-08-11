export class VaultEventQueue {
  private changed = new Set<string>();
  private deleted = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor(
    private readonly debounceMs: () => number,
    private readonly flushCallback: (changed: string[], deleted: string[]) => Promise<boolean>,
    private readonly maxBatchSize = 200
  ) {}

  markChanged(path: string): void {
    if (!path.toLowerCase().endsWith(".md")) return;
    this.deleted.delete(path);
    this.changed.add(path);
    this.schedule();
  }

  markDeleted(path: string): void {
    if (!path.toLowerCase().endsWith(".md")) return;
    this.changed.delete(path);
    this.deleted.add(path);
    this.schedule();
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.changed.size === 0 && this.deleted.size === 0) return;
    this.flushing = true;

    const changed = [...this.changed].slice(0, this.maxBatchSize);
    const remaining = Math.max(0, this.maxBatchSize - changed.length);
    const deleted = [...this.deleted].slice(0, remaining);
    for (const path of changed) this.changed.delete(path);
    for (const path of deleted) this.deleted.delete(path);

    try {
      const accepted = await this.flushCallback(changed, deleted);
      if (!accepted) {
        for (const path of changed) this.changed.add(path);
        for (const path of deleted) this.deleted.add(path);
      }
    } catch {
      for (const path of changed) this.changed.add(path);
      for (const path of deleted) this.deleted.add(path);
    } finally {
      this.flushing = false;
      if (this.changed.size || this.deleted.size) this.schedule();
    }
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.changed.clear();
    this.deleted.clear();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), Math.max(100, this.debounceMs()));
  }
}
