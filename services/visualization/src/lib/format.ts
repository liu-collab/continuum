import { format, formatDistanceToNow } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";

import {
  DashboardMetric,
  GovernanceExecutionDetail,
  MemoryStatus,
  MemoryType,
  MemoryViewMode,
  Scope,
  SourceHealthStatus
} from "@/lib/contracts";
import { createTranslator, DEFAULT_APP_LOCALE, type AppLocale } from "@/lib/i18n/messages";

function dateFnsLocale(locale: AppLocale) {
  return locale === "en-US" ? enUS : zhCN;
}

export function formatTimestamp(value: string | null | undefined, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const t = createTranslator(locale);

  if (!value) {
    return t("common.notRecorded");
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${format(date, "yyyy-MM-dd HH:mm:ss")} (${formatDistanceToNow(date, { addSuffix: true, locale: dateFnsLocale(locale) })})`;
}

export function formatLastSuccess(value: string | null | undefined, locale: AppLocale = DEFAULT_APP_LOCALE) {
  if (!value) {
    return createTranslator(locale)("health.neverConnected");
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return formatDistanceToNow(date, { addSuffix: true, locale: dateFnsLocale(locale) });
}

export function formatShortIdentifier(value: string | null | undefined, length = 8, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return createTranslator(locale)("common.notRecorded");
  }

  if (trimmed.length <= 24) {
    return trimmed;
  }

  return trimmed.slice(0, length).toLowerCase();
}

export function formatWorkspaceReference(value: string | null | undefined, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const t = createTranslator(locale);
  return value
    ? t("format.workspaceReference", { id: formatShortIdentifier(value, 8, locale) })
    : t("format.missingWorkspace");
}

export function formatSessionReference(value: string | null | undefined, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const t = createTranslator(locale);
  return value
    ? t("format.sessionReference", { id: formatShortIdentifier(value, 8, locale) })
    : t("format.missingSession");
}

export function formatSourceReference(value: string | null | undefined, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const t = createTranslator(locale);
  return value
    ? t("format.sourceReference", { id: formatShortIdentifier(value, 8, locale) })
    : t("format.missingSource");
}

export function formatDebugReference(value: string | null | undefined, locale: AppLocale = DEFAULT_APP_LOCALE) {
  return value ? formatShortIdentifier(value, 8, locale) : createTranslator(locale)("common.notRecorded");
}

export function formatRunTraceTitle(createdAt: string | null | undefined, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const t = createTranslator(locale);

  if (!createdAt) {
    return t("format.runTraceTitleWithTime", { time: t("common.notRecorded") });
  }

  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return t("format.runTraceTitle");
  }

  return t("format.runTraceTitleWithTime", { time: format(date, "yyyy-MM-dd HH:mm:ss") });
}

export function formatMetricValue(value: number | null, unit: DashboardMetric["unit"], locale: AppLocale = DEFAULT_APP_LOCALE) {
  const t = createTranslator(locale);

  if (value === null || Number.isNaN(value)) {
    return t("common.unavailable");
  }

  if (unit === "percent") {
    return `${(value * 100).toFixed(1)}%`;
  }

  if (unit === "ms") {
    return `${Math.round(value)} ms`;
  }

  return new Intl.NumberFormat(t("format.numberLocale")).format(value);
}

export function dashboardSeverityLabel(value: string) {
  const translated = createTranslator(DEFAULT_APP_LOCALE)(`enums.severity.${value}`);
  return translated === `enums.severity.${value}` ? value : translated;
}

export function dashboardSeverityTone(value: string) {
  if (value === "danger") return "danger";
  if (value === "warning") return "warning";
  if (value === "normal" || value === "healthy") return "success";
  return "neutral";
}

export function memoryTypeLabel(value: MemoryType, locale: AppLocale = DEFAULT_APP_LOCALE) {
  return createTranslator(locale)(`enums.memoryType.${value}`);
}

export function scopeLabel(value: Scope, locale: AppLocale = DEFAULT_APP_LOCALE) {
  return createTranslator(locale)(`enums.scope.${value}`);
}

export function scopeExplanation(value: Scope, originWorkspaceId?: string | null, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const t = createTranslator(locale);

  if (value === "user") {
    return originWorkspaceId
      ? t("service.memory.scopeUserWithOrigin", { workspace: formatWorkspaceReference(originWorkspaceId, locale) })
      : t("service.memory.scopeUser");
  }

  if (value === "workspace") {
    return t("service.memory.scopeWorkspace");
  }

  if (value === "task") {
    return t("service.memory.scopeTask");
  }

  return t("service.memory.scopeSession");
}

export function memoryViewModeLabel(value: MemoryViewMode, locale: AppLocale = DEFAULT_APP_LOCALE) {
  return createTranslator(locale)(`enums.memoryViewMode.${value}`);
}

export function memoryViewModeExplanation(value: MemoryViewMode, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const t = createTranslator(locale);
  return value === "workspace_only"
    ? t("service.memory.modeWorkspaceOnlyExplanation")
    : t("service.memory.modeWorkspacePlusGlobalExplanation");
}

export function visibilitySummary(
  scope: Scope,
  memoryViewMode: MemoryViewMode,
  originWorkspaceId?: string | null,
  locale: AppLocale = DEFAULT_APP_LOCALE
) {
  const t = createTranslator(locale);

  if (scope === "user") {
    return memoryViewMode === "workspace_only"
      ? t("service.memory.hiddenGlobalInWorkspaceOnly")
      : originWorkspaceId
        ? t("service.memory.visibleGlobalWithOrigin", { workspace: formatWorkspaceReference(originWorkspaceId, locale) })
        : t("service.memory.visibleGlobal");
  }

  if (scope === "workspace") {
    return t("service.memory.visibleWorkspace");
  }

  if (scope === "task") {
    return t("service.memory.visibleTask");
  }

  return t("service.memory.visibleSession");
}

export function memoryStatusLabel(value: MemoryStatus, locale: AppLocale = DEFAULT_APP_LOCALE) {
  return createTranslator(locale)(`enums.memoryStatus.${value}`);
}

export function memoryStatusExplanation(value: MemoryStatus, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const t = createTranslator(locale);
  switch (value) {
    case "active":
      return t("service.memory.statusActive");
    case "pending_confirmation":
      return t("service.memory.statusPending");
    case "superseded":
      return t("service.memory.statusSuperseded");
    case "archived":
      return t("service.memory.statusArchived");
    case "deleted":
      return t("service.memory.statusDeleted");
  }
}

export function memoryModeSummary(value: MemoryViewMode | null | undefined, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const t = createTranslator(locale);
  if (value === "workspace_only") {
    return t("service.memory.modeSummaryWorkspaceOnly");
  }

  if (value === "workspace_plus_global") {
    return t("service.memory.modeSummaryWorkspacePlusGlobal");
  }

  return t("service.memory.modeSummaryMissing");
}

export function sourceStatusTone(status: SourceHealthStatus) {
  switch (status) {
    case "healthy":
      return "success";
    case "partial":
      return "warning";
    case "misconfigured":
    case "timeout":
    case "unavailable":
      return "danger";
  }
}

export function sourceStatusLabel(status: SourceHealthStatus, locale: AppLocale = DEFAULT_APP_LOCALE) {
  return createTranslator(locale)(`enums.sourceStatus.${status}`);
}

export function governanceProposalTypeLabel(value: string, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const translated = createTranslator(locale)(`enums.governanceProposal.${value}`);
  return translated === `enums.governanceProposal.${value}` ? value : translated;
}

export function governanceExecutionStatusLabel(value: string, locale: AppLocale = DEFAULT_APP_LOCALE) {
  const translated = createTranslator(locale)(`enums.governanceStatus.${value}`);
  return translated === `enums.governanceStatus.${value}` ? value : translated;
}

export function governanceStatusTone(value: string) {
  if (value === "executed" || value === "verified") {
    return "success";
  }

  if (value === "failed" || value === "rejected_by_guard") {
    return "danger";
  }

  if (value === "executing" || value === "proposed" || value === "cancelled" || value === "superseded") {
    return "warning";
  }

  return "neutral";
}

export function summarizeGovernanceTarget(
  targets: GovernanceExecutionDetail["targets"] | Array<{ recordId: string | null; conflictId: string | null; role: string }>,
  locale: AppLocale = DEFAULT_APP_LOCALE
) {
  const parts = targets.map((target) => {
    if (target.recordId) {
      return `${target.role}:${target.recordId}`;
    }
    if (target.conflictId) {
      return `${target.role}:${target.conflictId}`;
    }
    return target.role;
  });

  return parts.length > 0 ? parts.join(" · ") : createTranslator(locale)("service.memory.targetMissing");
}
