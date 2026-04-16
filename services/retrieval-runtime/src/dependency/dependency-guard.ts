import type { Logger } from "pino";

import { DependencyUnavailableError, TimeoutAppError } from "../errors.js";
import type { DependencyStatus, DependencyStatusSnapshot } from "../shared/types.js";
import { nowIso } from "../shared/utils.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";

export interface GuardResult<T> {
  ok: boolean;
  value?: T;
  error?: DependencyUnavailableError | TimeoutAppError;
  status: DependencyStatus;
}

export class DependencyGuard {
  constructor(
    private readonly repository: RuntimeRepository,
    private readonly logger: Logger,
  ) {}

  async run<T>(
    name: DependencyStatus["name"],
    timeoutMs: number,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<GuardResult<T>> {
    const controller = new AbortController();
    let rejectTimeout: ((error: TimeoutAppError) => void) | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      rejectTimeout = reject;
    });
    const timeoutHandle = setTimeout(() => {
      if (controller.signal.aborted) {
        return;
      }
        controller.abort("timeout");
      rejectTimeout?.(new TimeoutAppError(`${name} timed out`, { timeout_ms: timeoutMs }));
    }, timeoutMs);

    try {
      const value = await Promise.race([task(controller.signal), timeoutPromise]);
      const status: DependencyStatus = {
        name,
        status: "healthy",
        detail: "request completed",
        last_checked_at: nowIso(),
      };
      await this.repository.updateDependencyStatus(status);
      return { ok: true, value, status };
    } catch (error) {
      const appError =
        controller.signal.aborted
          ? new TimeoutAppError(`${name} timed out`, { timeout_ms: timeoutMs })
          : new DependencyUnavailableError(`${name} unavailable`, {
              cause: error instanceof Error ? error.message : String(error),
            });

      const status: DependencyStatus = {
        name,
        status: controller.signal.aborted ? "degraded" : "unavailable",
        detail: appError.message,
        last_checked_at: nowIso(),
      };

      await this.repository.updateDependencyStatus(status);
      this.logger.warn({ dependency: name, err: error }, "dependency request degraded");
      return { ok: false, error: appError, status };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async snapshot(): Promise<DependencyStatusSnapshot> {
    return this.repository.getDependencyStatus();
  }
}
