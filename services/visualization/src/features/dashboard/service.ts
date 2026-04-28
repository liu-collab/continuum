import "server-only";

import type { DashboardResponse } from "@/lib/contracts";
import { getCachedValue } from "@/lib/cache";
import { getAppConfig } from "@/lib/env";
import { getRequestLocale } from "@/lib/i18n/server";
import { fetchRuntimeMetrics, fetchRuntimeRuns } from "@/lib/server/runtime-observe-client";
import { fetchGovernanceExecutions } from "@/lib/server/storage-governance-executions-client";
import { fetchStorageMetrics, fetchStorageWriteJobs } from "@/lib/server/storage-observe-client";

import { buildDashboardDiagnosis, buildDiagnosisCards } from "./diagnosis-engine";
import { localizedMetric } from "./metric-computer";
import {
  computeGovernanceWindowTrend,
  computeRuntimeWindowTrend,
  estimateStorageTrend,
  localizedTrend,
  ratio
} from "./trend-analyzer";

export { buildDashboardDiagnosis } from "./diagnosis-engine";
export { computeRuntimeWindowTrend, estimateStorageTrend } from "./trend-analyzer";

export async function getDashboard(window: string): Promise<DashboardResponse> {
  const { values } = getAppConfig();
  const locale = await getRequestLocale();

  return getCachedValue(`dashboard:${locale}:${window}`, values.DASHBOARD_CACHE_MS, async () => {
    const [runtimeCurrent, runtimeRuns, storageCurrent, jobs, governance] = await Promise.all([
      fetchRuntimeMetrics({ locale }),
      fetchRuntimeRuns("", { locale }),
      fetchStorageMetrics({ locale }),
      fetchStorageWriteJobs({ locale }),
      fetchGovernanceExecutions({ limit: 100 }, { locale })
    ]);

    const runtimeTrend = computeRuntimeWindowTrend(window, runtimeRuns.data);
    const storageTrend = estimateStorageTrend(window, jobs.jobs);
    const governanceTrend = computeGovernanceWindowTrend(window, governance.items, runtimeRuns.data.recallRuns);

    const triggerRuns = runtimeRuns.data.triggerRuns;
    const recallRuns = runtimeRuns.data.recallRuns;
    const selectedScopeCounts = recallRuns.flatMap((run) => run.scopeHitCounts);
    const totalSelectedScopeHits = selectedScopeCounts.reduce((sum, item) => sum + item.count, 0);
    const globalScopeHits = selectedScopeCounts
      .filter((item) => item.scope === "user")
      .reduce((sum, item) => sum + item.count, 0);
    const workspaceScopeHits = selectedScopeCounts
      .filter((item) => item.scope === "workspace")
      .reduce((sum, item) => sum + item.count, 0);
    const workspaceOnlyTurns = triggerRuns.filter((run) => run.memoryMode === "workspace_only").length;

    const retrievalMetrics = [
      localizedMetric("trigger_rate", runtimeCurrent.metrics?.triggerRate ?? null, "percent", "runtime", 0.7, 0.5, "lower_is_worse", locale),
      localizedMetric("recall_hit_rate", runtimeCurrent.metrics?.recallHitRate ?? null, "percent", "runtime", 0.6, 0.4, "lower_is_worse", locale),
      localizedMetric("empty_recall_rate", runtimeCurrent.metrics?.emptyRecallRate ?? null, "percent", "runtime", 0.2, 0.35, "higher_is_worse", locale),
      localizedMetric("injection_rate", runtimeCurrent.metrics?.injectionRate ?? null, "percent", "runtime", 0.45, 0.25, "lower_is_worse", locale),
      localizedMetric("trim_rate", runtimeCurrent.metrics?.trimRate ?? null, "percent", "runtime", 0.15, 0.3, "higher_is_worse", locale),
      localizedMetric("recall_p95_ms", runtimeCurrent.metrics?.recallP95Ms ?? null, "ms", "runtime", 800, 1200, "higher_is_worse", locale),
      localizedMetric("injection_p95_ms", runtimeCurrent.metrics?.injectionP95Ms ?? null, "ms", "runtime", 400, 700, "higher_is_worse", locale),
      localizedMetric("writeback_submit_rate", runtimeCurrent.metrics?.writeBackSubmitRate ?? null, "percent", "runtime", 0.25, 0.1, "lower_is_worse", locale),
      localizedMetric("runtime_outbox_pending_count", runtimeCurrent.metrics?.outboxPendingCount ?? null, "count", "runtime", 1, 5, "higher_is_worse", locale),
      localizedMetric("runtime_outbox_dead_letter_count", runtimeCurrent.metrics?.outboxDeadLetterCount ?? null, "count", "runtime", 1, 3, "higher_is_worse", locale),
      localizedMetric("global_scope_share", totalSelectedScopeHits > 0 ? globalScopeHits / totalSelectedScopeHits : null, "percent", "runtime", 0.5, 0.7, "higher_is_worse", locale),
      localizedMetric("workspace_scope_share", totalSelectedScopeHits > 0 ? workspaceScopeHits / totalSelectedScopeHits : null, "percent", "runtime", undefined, undefined, "higher_is_worse", locale),
      localizedMetric("workspace_only_rate", triggerRuns.length > 0 ? workspaceOnlyTurns / triggerRuns.length : null, "percent", "runtime", undefined, undefined, "higher_is_worse", locale)
    ];

    const storageMetrics = [
      localizedMetric("write_accepted", storageCurrent.metrics?.writeAccepted ?? null, "count", "storage", undefined, undefined, "higher_is_worse", locale),
      localizedMetric("write_succeeded", storageCurrent.metrics?.writeSucceeded ?? null, "count", "storage", undefined, undefined, "higher_is_worse", locale),
      localizedMetric("duplicate_ignored_rate", storageCurrent.metrics?.duplicateIgnoredRate ?? null, "percent", "storage", 0.25, 0.45, "higher_is_worse", locale),
      localizedMetric("merge_rate", storageCurrent.metrics?.mergeRate ?? null, "percent", "storage", undefined, undefined, "higher_is_worse", locale),
      localizedMetric("conflict_rate", storageCurrent.metrics?.conflictRate ?? null, "percent", "storage", 0.08, 0.15, "higher_is_worse", locale),
      localizedMetric("dead_letter_jobs", storageCurrent.metrics?.deadLetterJobs ?? jobs.jobs?.deadLetter ?? null, "count", "storage", 1, 5, "higher_is_worse", locale),
      localizedMetric("refresh_failure_rate", storageCurrent.metrics?.refreshFailureRate ?? null, "percent", "storage", 0.02, 0.1, "higher_is_worse", locale),
      localizedMetric("write_p95_ms", storageCurrent.metrics?.writeP95Ms ?? null, "ms", "storage", 1000, 1500, "higher_is_worse", locale),
      localizedMetric("new_pending_embedding_records", storageCurrent.metrics?.newPendingEmbeddingRecords ?? null, "count", "storage", 1, 10, "higher_is_worse", locale),
      localizedMetric("retry_pending_embedding_records", storageCurrent.metrics?.retryPendingEmbeddingRecords ?? null, "count", "storage", 1, 5, "higher_is_worse", locale),
      localizedMetric("oldest_pending_embedding_age_seconds", storageCurrent.metrics?.oldestPendingEmbeddingAgeSeconds ?? null, "count", "storage", 60, 300, "higher_is_worse", locale),
      localizedMetric("governance_proposal_count", storageCurrent.metrics?.governanceProposalCount ?? null, "count", "storage", undefined, undefined, "higher_is_worse", locale),
      localizedMetric(
        "governance_verification_pass_rate",
        ratio(storageCurrent.metrics?.governanceVerifierApprovedCount ?? 0, storageCurrent.metrics?.governanceVerifierRequiredCount ?? 0),
        "percent",
        "storage",
        0.8,
        0.6,
        "lower_is_worse",
        locale
      ),
      localizedMetric(
        "governance_execution_success_rate",
        ratio(storageCurrent.metrics?.governanceExecutionSuccessCount ?? 0, storageCurrent.metrics?.governanceExecutionCount ?? 0),
        "percent",
        "storage",
        0.8,
        0.6,
        "lower_is_worse",
        locale
      ),
      localizedMetric(
        "governance_soft_delete_rate",
        ratio(storageCurrent.metrics?.governanceSoftDeleteCount ?? 0, storageCurrent.metrics?.governanceExecutionCount ?? 0),
        "percent",
        "storage",
        0.2,
        0.4,
        "higher_is_worse",
        locale
      ),
      localizedMetric(
        "governance_retry_rate",
        ratio(storageCurrent.metrics?.governanceRetryCount ?? 0, storageCurrent.metrics?.governanceExecutionCount ?? 0),
        "percent",
        "storage",
        0.05,
        0.15,
        "higher_is_worse",
        locale
      ),
      localizedMetric("governance_recall_hit_rate_after", governanceTrend.recallHitRateAfterGovernance.current, "percent", "storage", undefined, undefined, "higher_is_worse", locale)
    ];

    const trends = [
      localizedTrend("empty_recall_shift", "runtime", "percent", runtimeTrend.emptyRecall, window, 0.2, 0.35, "higher_is_worse", locale),
      localizedTrend("writeback_backlog", "storage", "count", storageTrend.backlog, window, 5, 10, "higher_is_worse", locale),
      localizedTrend("conflict_spike", "storage", "count", storageTrend.conflict, window, 1, 3, "higher_is_worse", locale),
      localizedTrend("runtime_vs_storage_latency", "runtime", "ms", runtimeTrend.recallLatency, window, 800, 1200, "higher_is_worse", locale),
      localizedTrend("scope_mix_shift", "runtime", "percent", runtimeTrend.globalScopeShare, window, 0.5, 0.7, "higher_is_worse", locale),
      localizedTrend("governance_proposal_volume", "storage", "count", governanceTrend.proposalVolume, window, undefined, undefined, "higher_is_worse", locale),
      localizedTrend("governance_verification_pass_rate", "storage", "percent", governanceTrend.verificationPassRate, window, 0.8, 0.6, "lower_is_worse", locale),
      localizedTrend("governance_execution_success_rate", "storage", "percent", governanceTrend.executionSuccessRate, window, 0.8, 0.6, "lower_is_worse", locale),
      localizedTrend("governance_retry_rate", "storage", "percent", governanceTrend.retryRate, window, 0.05, 0.15, "higher_is_worse", locale),
      localizedTrend("governance_recall_hit_rate_after", "storage", "percent", governanceTrend.recallHitRateAfterGovernance, window, 0.5, 0.3, "lower_is_worse", locale)
    ];

    const sourceStatus = [runtimeCurrent.status, storageCurrent.status, jobs.status, governance.status];
    const degradedSources = sourceStatus
      .filter((source) => source.status !== "healthy")
      .map((source) => source.label);

    return {
      retrievalMetrics,
      storageMetrics,
      trendWindow: window,
      diagnosis: buildDashboardDiagnosis(retrievalMetrics, storageMetrics, degradedSources, locale),
      diagnosisCards: buildDiagnosisCards(
        retrievalMetrics,
        storageMetrics,
        runtimeTrend,
        storageTrend,
        governanceTrend,
        degradedSources,
        locale
      ),
      trends,
      sourceStatus
    };
  });
}