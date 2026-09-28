export class BoundedQueue<T> {
  private readonly items: T[] = [];
  private readonly waiters: Array<() => void> = [];
  private readonly capacityValue: number;
  private overflowCountValue = 0;
  private maxDepthValue = 0;
  private totalWaitMs = 0;
  private enqueueCountValue = 0;

  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error('Queue capacity must be a positive integer');
    }
    this.capacityValue = capacity;
  }

  get capacity(): number {
    return this.capacityValue;
  }

  get depth(): number {
    return this.items.length;
  }

  get overflowCount(): number {
    return this.overflowCountValue;
  }

  get maxDepth(): number {
    return this.maxDepthValue;
  }

  get averageWaitMs(): number {
    return this.enqueueCountValue === 0 ? 0 : this.totalWaitMs / this.enqueueCountValue;
  }

  async enqueue(item: T, timeoutMs: number): Promise<boolean> {
    const startedAt = performance.now();
    const deadline = startedAt + Math.max(0, timeoutMs);

    while (this.items.length >= this.capacityValue) {
      if (performance.now() >= deadline) {
        this.overflowCountValue += 1;
        return false;
      }

      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        const remaining = Math.max(1, deadline - performance.now());
        setTimeout(() => {
          const index = this.waiters.indexOf(resolve);
          if (index >= 0) {
            this.waiters.splice(index, 1);
          }
          resolve();
        }, Math.min(10, remaining));
      });
    }

    this.items.push(item);
    this.maxDepthValue = Math.max(this.maxDepthValue, this.items.length);
    this.totalWaitMs += performance.now() - startedAt;
    this.enqueueCountValue += 1;
    return true;
  }

  drain(maxItems: number): T[] {
    const count = Math.max(0, Math.min(maxItems, this.items.length));
    const drained = this.items.splice(0, count);
    for (const resolve of this.waiters.splice(0)) {
      resolve();
    }
    return drained;
  }
}
