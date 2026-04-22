import type { Logger } from "pino";

import { DependencyUnavailableError, TimeoutAppError } from "../errors.js";
import type { DependencyStatus, DependencyStatusSnapshot } from "../shared/types.js";
import { nowIso } from "../shared/utils.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";
import type { AppConfig } from "../config.js";

export interface GuardResult<T> {
  ok: boolean;
  value?: T;
  error?: DependencyUnavailableError | TimeoutAppError;
  status: DependencyStatus;
}

interface DependencyHealthWindow {
  consecutiveFailures: number;
  recentOutcomes: boolean[];
  degradedUntilMs?: number;
  recoverySuccesses: number;
}

export class DependencyGuard {
  private readonly healthWindows = new Map<DependencyStatus["name"], DependencyHealthWindow>();

  constructor(
    private readonly repository: RuntimeRepository,
    private readonly logger: Logger,
    private readonly config?: Pick<
      AppConfig,
      "MEMORY_LLM_FALLBACK_ENABLED" | "MEMORY_LLM_DEGRADED_THRESHOLD" | "MEMORY_LLM_RECOVERY_INTERVAL_MS"
    >,
  ) {}

  async run<T>(
    name: DependencyStatus["name"],
    timeoutMs: number,
    task: (signal: AbortSignal) => Promise<T>,
  ): Promise<GuardResult<T>> {
    const preflight = await this.checkCircuitBeforeRun<T>(name);
    if (preflight) {
      return preflight;
    }

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
      this.recordSuccess(name);
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

      this.recordFailure(name);
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

  private getWindow(name: DependencyStatus["name"]) {
    const existing = this.healthWindows.get(name);
    if (existing) {
      return existing;
    }
    const created: DependencyHealthWindow = {
      consecutiveFailures: 0,
      recentOutcomes: [],
      recoverySuccesses: 0,
    };
    this.healthWindows.set(name, created);
    return created;
  }

  private isMemoryLlmGuarded(name: DependencyStatus["name"]) {
    return name === "memory_llm" && (this.config?.MEMORY_LLM_FALLBACK_ENABLED ?? true);
  }

  private async checkCircuitBeforeRun<T>(name: DependencyStatus["name"]): Promise<GuardResult<T> | null> {
    if (!this.isMemoryLlmGuarded(name)) {
      return null;
    }

    const window = this.getWindow(name);
    if (!window.degradedUntilMs) {
      return null;
    }

    if (Date.now() >= window.degradedUntilMs) {
      return null;
    }

    const status: DependencyStatus = {
      name,
      status: "degraded",
      detail: `${name} recovery window is still cooling down`,
      last_checked_at: nowIso(),
    };
    await this.repository.updateDependencyStatus(status);
    return {
      ok: false,
      error: new DependencyUnavailableError(`${name} recovery window is still cooling down`, {
        cause: "dependency_recovery_pending",
      }),
      status,
    };
  }

  private recordOutcome(name: DependencyStatus["name"], success: boolean) {
    if (!this.isMemoryLlmGuarded(name)) {
      return;
    }

    const window = this.getWindow(name);
    window.recentOutcomes.push(success);
    while (window.recentOutcomes.length > 10) {
      window.recentOutcomes.shift();
    }

    if (success) {
      window.consecutiveFailures = 0;
      if (window.degradedUntilMs) {
        window.recoverySuccesses += 1;
        if (window.recoverySuccesses >= 3) {
          window.degradedUntilMs = undefined;
          window.recoverySuccesses = 0;
        }
      } else {
        window.recoverySuccesses = 0;
      }
      return;
    }

    window.consecutiveFailures += 1;
    window.recoverySuccesses = 0;

    const failureRate =
      window.recentOutcomes.length === 0
        ? 0
        : window.recentOutcomes.filter((item) => !item).length / window.recentOutcomes.length;

    if (window.consecutiveFailures >= 3 || failureRate > (this.config?.MEMORY_LLM_DEGRADED_THRESHOLD ?? 0.5)) {
      window.degradedUntilMs = Date.now() + (this.config?.MEMORY_LLM_RECOVERY_INTERVAL_MS ?? 5 * 60 * 1000);
    }
  }

  private recordSuccess(name: DependencyStatus["name"]) {
    this.recordOutcome(name, true);
  }

  private recordFailure(name: DependencyStatus["name"]) {
    this.recordOutcome(name, false);
  }
}
