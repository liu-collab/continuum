export interface LiteWriteQueueStats {
  pending: number;
  last_error?: string;
  last_settled_at?: string;
}

export class LiteWriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private lastError: string | undefined;
  private lastSettledAt: string | undefined;

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.pending += 1;

    const run = this.tail
      .catch(() => undefined)
      .then(async () => {
        try {
          const result = await operation();
          this.lastError = undefined;
          return result;
        } catch (error) {
          this.lastError = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          this.pending -= 1;
          this.lastSettledAt = new Date().toISOString();
        }
      });

    this.tail = run.catch(() => undefined);
    return run;
  }

  async onIdle(): Promise<void> {
    await this.tail.catch(() => undefined);
  }

  stats(): LiteWriteQueueStats {
    return {
      pending: this.pending,
      ...(this.lastError ? { last_error: this.lastError } : {}),
      ...(this.lastSettledAt ? { last_settled_at: this.lastSettledAt } : {}),
    };
  }
}
