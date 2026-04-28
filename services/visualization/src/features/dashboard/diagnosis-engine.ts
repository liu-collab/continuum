import { DashboardDiagnosis, DashboardDiagnosisCard, DashboardMetric } from "@/lib/contracts";
import { resolveDashboardThresholds, type DashboardThresholds } from "@/lib/dashboard-thresholds";
import { formatMetricValue } from "@/lib/format";
import { createTranslator, joinLocalizedList, type AppLocale } from "@/lib/i18n/messages";

import { computeGovernanceWindowTrend, computeRuntimeWindowTrend, estimateStorageTrend } from "./trend-analyzer";

function diagnosisCard(
  key: string,
  source: DashboardDiagnosisCard["source"],
  title: string,
  summary: string,
  severity: DashboardDiagnosisCard["severity"]
): DashboardDiagnosisCard {
  return { key, source, title, summary, severity };
}

export function buildDashboardDiagnosis(
  retrievalMetrics: DashboardMetric[],
  storageMetrics: DashboardMetric[],
  degradedSources: string[],
  locale: AppLocale = "zh-CN",
  thresholds: DashboardThresholds = resolveDashboardThresholds()
): DashboardDiagnosis {
  const t = createTranslator(locale);

  if (degradedSources.length > 0) {
    return {
      title: t("service.dashboard.diagnosisDependencyTitle"),
      summary: t("service.dashboard.diagnosisDependencySummary", {
        sources: joinLocalizedList(locale, degradedSources)
      }),
      severity: "danger"
    };
  }

  const emptyRecall = retrievalMetrics.find((item) => item.key === "empty_recall_rate")?.value ?? null;
  const conflictRate = storageMetrics.find((item) => item.key === "conflict_rate")?.value ?? null;
  const recallP95 = retrievalMetrics.find((item) => item.key === "recall_p95_ms")?.value ?? null;
  const writeP95 = storageMetrics.find((item) => item.key === "write_p95_ms")?.value ?? null;

  if (emptyRecall !== null && emptyRecall >= thresholds.emptyRecall.danger) {
    return {
      title: t("service.dashboard.diagnosisRecallTitle"),
      summary: t("service.dashboard.diagnosisRecallSummary"),
      severity: "warning"
    };
  }

  if (conflictRate !== null && conflictRate >= thresholds.conflictRate.danger) {
    return {
      title: t("service.dashboard.diagnosisMemoryQualityTitle"),
      summary: t("service.dashboard.diagnosisMemoryQualitySummary"),
      severity: "warning"
    };
  }

  if ((recallP95 ?? 0) >= thresholds.recallP95.danger || (writeP95 ?? 0) >= thresholds.writeP95.danger) {
    return {
      title: t("service.dashboard.diagnosisLatencyTitle"),
      summary: t("service.dashboard.diagnosisLatencySummary"),
      severity: "warning"
    };
  }

  return {
    title: t("service.dashboard.diagnosisHealthyTitle"),
    summary: t("service.dashboard.diagnosisHealthySummary"),
    severity: "info"
  };
}

export function buildDiagnosisCards(
  retrievalMetrics: DashboardMetric[],
  storageMetrics: DashboardMetric[],
  runtimeTrend: ReturnType<typeof computeRuntimeWindowTrend>,
  storageTrend: ReturnType<typeof estimateStorageTrend>,
  governanceTrend: ReturnType<typeof computeGovernanceWindowTrend>,
  degradedSources: string[],
  locale: AppLocale = "zh-CN",
  thresholds: DashboardThresholds = resolveDashboardThresholds()
) {
  const t = createTranslator(locale);
  const emptyRecall = retrievalMetrics.find((item) => item.key === "empty_recall_rate")?.value ?? null;
  const conflictRate = storageMetrics.find((item) => item.key === "conflict_rate")?.value ?? null;
  const workspaceOnlyRate = retrievalMetrics.find((item) => item.key === "workspace_only_rate")?.value ?? null;
  const globalShare = retrievalMetrics.find((item) => item.key === "global_scope_share")?.value ?? null;
  const workspaceShare = retrievalMetrics.find((item) => item.key === "workspace_scope_share")?.value ?? null;
  const governanceSuccessRate =
    storageMetrics.find((item) => item.key === "governance_execution_success_rate")?.value ?? null;
  const governanceRetryRate =
    storageMetrics.find((item) => item.key === "governance_retry_rate")?.value ?? null;

  return [
    diagnosisCard(
      "empty_recall_trend",
      "runtime",
      t("service.dashboard.cards.emptyRecallTitle"),
      degradedSources.length > 0
        ? t("service.dashboard.cards.emptyRecallDegraded", {
            sources: joinLocalizedList(locale, degradedSources)
          })
        : emptyRecall !== null && emptyRecall >= thresholds.emptyRecall.danger
          ? t("service.dashboard.cards.emptyRecallWarning")
          : t("service.dashboard.cards.emptyRecallOk"),
      degradedSources.length > 0 ? "danger" : emptyRecall !== null && emptyRecall >= thresholds.emptyRecall.danger ? "warning" : "info"
    ),
    diagnosisCard(
      "scope_mix",
      "cross",
      t("service.dashboard.cards.scopeMixTitle"),
      workspaceOnlyRate === 1
        ? t("service.dashboard.cards.scopeWorkspaceOnly")
        : globalShare !== null && workspaceShare !== null
          ? t("service.dashboard.cards.scopeMix", {
              global: formatMetricValue(globalShare, "percent", locale),
              workspace: formatMetricValue(workspaceShare, "percent", locale)
            })
          : t("service.dashboard.cards.scopeInsufficient"),
      workspaceOnlyRate === 1 ? "info" : globalShare !== null && globalShare > thresholds.globalScopeShareCardWarning ? "warning" : "info"
    ),
    diagnosisCard(
      "writeback_backlog",
      "storage",
      t("service.dashboard.cards.backlogTitle"),
      storageTrend.backlog.current !== null && storageTrend.backlog.current > thresholds.writebackBacklog.warning
        ? t("service.dashboard.cards.backlogWarning")
        : t("service.dashboard.cards.backlogOk"),
      storageTrend.backlog.current !== null && storageTrend.backlog.current > thresholds.writebackBacklog.warning ? "warning" : "info"
    ),
    diagnosisCard(
      "conflict_pressure",
      "storage",
      t("service.dashboard.cards.conflictTitle"),
      conflictRate !== null && conflictRate >= thresholds.conflictRate.danger
        ? t("service.dashboard.cards.conflictWarning")
        : t("service.dashboard.cards.conflictOk"),
      conflictRate !== null && conflictRate >= thresholds.conflictRate.danger ? "warning" : "info"
    ),
    diagnosisCard(
      "governance_execution",
      "storage",
      t("service.dashboard.cards.governanceTitle"),
      governanceRetryRate !== null && governanceRetryRate >= thresholds.governanceRetry.danger
        ? t("service.dashboard.cards.governanceRetryWarning")
        : governanceSuccessRate !== null && governanceSuccessRate < thresholds.governanceExecutionSuccess.warning
          ? t("service.dashboard.cards.governanceSuccessWarning")
          : governanceTrend.recallHitRateAfterGovernance.current !== null
            ? t("service.dashboard.cards.governanceRecallHit", {
                rate: formatMetricValue(governanceTrend.recallHitRateAfterGovernance.current, "percent", locale)
              })
            : t("service.dashboard.cards.governanceOk"),
      governanceRetryRate !== null && governanceRetryRate >= thresholds.governanceRetry.danger
        ? "warning"
        : governanceSuccessRate !== null && governanceSuccessRate < thresholds.governanceExecutionSuccess.warning
          ? "warning"
          : "info"
    )
  ];
}
