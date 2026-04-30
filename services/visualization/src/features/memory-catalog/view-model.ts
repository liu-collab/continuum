import type { Route } from "next";

import type { MemoryCatalogFilters, MemoryCatalogResponse } from "@/lib/contracts";
import {
  formatSessionReference,
  formatSourceReference,
  formatWorkspaceReference,
  memoryViewModeExplanation
} from "@/lib/format";
import { createTranslator, type AppLocale } from "@/lib/i18n/messages";
import { toMemoryCatalogQuery } from "@/lib/query-params";

export type MemoryCatalogQuickView = {
  key: string;
  label: string;
  description: string;
  href: Route;
  active: boolean;
};

export type MemoryCatalogFilterChip = {
  key: string;
  label: string;
  href: Route;
  active: boolean;
};

function isImplicitGlobalView(filters: MemoryCatalogFilters) {
  return (
    !filters.workspaceId
    && !filters.taskId
    && !filters.sessionId
    && !filters.sourceRef
    && !filters.scope
    && filters.memoryViewMode === "workspace_plus_global"
  );
}

export function buildViewSummary(filters: MemoryCatalogFilters, locale: AppLocale) {
  const t = createTranslator(locale);
  const base = memoryViewModeExplanation(filters.memoryViewMode, locale);

  if (filters.memoryViewMode === "workspace_only") {
    return filters.workspaceId
      ? t("service.memory.workspaceOnlySummaryWithWorkspace", {
          base,
          workspace: formatWorkspaceReference(filters.workspaceId, locale),
          session: filters.sessionId
            ? t("service.memory.sessionSuffix", { session: formatSessionReference(filters.sessionId, locale) })
            : "",
          source: filters.sourceRef
            ? t("service.memory.sourceSuffix", { source: formatSourceReference(filters.sourceRef, locale) })
            : ""
        })
      : t("service.memory.workspaceOnlySummaryMissingWorkspace", { base });
  }

  if (filters.scope === "user" || isImplicitGlobalView(filters)) {
    return t("service.memory.globalViewSummary", { base });
  }

  return filters.workspaceId
    ? t("service.memory.workspacePlusSummaryWithWorkspace", {
        base,
        workspace: formatWorkspaceReference(filters.workspaceId, locale),
        session: filters.sessionId
          ? t("service.memory.sessionSentence", { session: formatSessionReference(filters.sessionId, locale) })
          : "",
        source: filters.sourceRef
          ? t("service.memory.sourceSentence", { source: formatSourceReference(filters.sourceRef, locale) })
          : ""
      })
    : t("service.memory.workspacePlusSummaryMissingWorkspace", { base });
}

function buildQuickViewHref(filters: MemoryCatalogFilters) {
  const query = toMemoryCatalogQuery(filters);
  return (query ? `/memories?${query}` : "/memories") as Route;
}

function isQuickViewActive(current: MemoryCatalogFilters, target: MemoryCatalogFilters) {
  const normalizedCurrent = isImplicitGlobalView(current)
    ? { ...current, scope: "user" as const }
    : current;
  const normalizedTarget = isImplicitGlobalView(target)
    ? { ...target, scope: "user" as const }
    : target;

  return (
    normalizedCurrent.workspaceId === normalizedTarget.workspaceId
    && normalizedCurrent.taskId === normalizedTarget.taskId
    && normalizedCurrent.sessionId === normalizedTarget.sessionId
    && normalizedCurrent.sourceRef === normalizedTarget.sourceRef
    && normalizedCurrent.memoryViewMode === normalizedTarget.memoryViewMode
    && normalizedCurrent.memoryType === normalizedTarget.memoryType
    && normalizedCurrent.scope === normalizedTarget.scope
    && normalizedCurrent.status === normalizedTarget.status
    && normalizedCurrent.updatedFrom === normalizedTarget.updatedFrom
    && normalizedCurrent.updatedTo === normalizedTarget.updatedTo
  );
}

function createQuickView(
  current: MemoryCatalogFilters,
  key: string,
  label: string,
  description: string,
  target: Partial<MemoryCatalogFilters>
): MemoryCatalogQuickView {
  const normalizedTarget: MemoryCatalogFilters = {
    workspaceId: target.workspaceId,
    taskId: target.taskId,
    sessionId: target.sessionId,
    sourceRef: target.sourceRef,
    memoryViewMode: target.memoryViewMode ?? "workspace_plus_global",
    memoryType: target.memoryType,
    scope: target.scope,
    status: target.status,
    updatedFrom: target.updatedFrom,
    updatedTo: target.updatedTo,
    page: 1,
    pageSize: current.pageSize
  };

  return {
    key,
    label,
    description,
    href: buildQuickViewHref(normalizedTarget),
    active: isQuickViewActive(current, normalizedTarget)
  };
}

function createFilterChip(
  current: MemoryCatalogFilters,
  key: string,
  label: string,
  target: Partial<MemoryCatalogFilters>
): MemoryCatalogFilterChip {
  const normalizedTarget: MemoryCatalogFilters = {
    workspaceId: current.workspaceId,
    taskId: current.taskId,
    sessionId: current.sessionId,
    sourceRef: current.sourceRef,
    memoryViewMode: current.memoryViewMode,
    memoryType: undefined,
    scope: undefined,
    status: undefined,
    updatedFrom: current.updatedFrom,
    updatedTo: current.updatedTo,
    page: 1,
    pageSize: current.pageSize,
    ...target
  };

  return {
    key,
    label,
    href: buildQuickViewHref(normalizedTarget),
    active: isQuickViewActive(current, normalizedTarget)
  };
}

export function buildMemoryCatalogFilterChips(
  filters: MemoryCatalogFilters,
  pendingConfirmationCount: number,
  locale: AppLocale = "zh-CN"
): MemoryCatalogFilterChip[] {
  const t = createTranslator(locale);

  return [
    createFilterChip(filters, "active", t("memories.quickFilters.active"), {
      status: "active"
    }),
    createFilterChip(filters, "pending", t("memories.quickFilters.pending", {
      count: pendingConfirmationCount
    }), {
      status: "pending_confirmation"
    }),
    createFilterChip(filters, "fact", t("memories.quickFilters.fact"), {
      status: "active",
      memoryType: "fact"
    }),
    createFilterChip(filters, "preference", t("memories.quickFilters.preference"), {
      status: "active",
      memoryType: "preference"
    }),
    createFilterChip(filters, "task-state", t("memories.quickFilters.taskState"), {
      status: "active",
      memoryType: "task_state"
    }),
    createFilterChip(filters, "episodic", t("memories.quickFilters.episodic"), {
      status: "active",
      memoryType: "episodic"
    })
  ];
}

export function buildMemoryCatalogQuickViews(
  filters: MemoryCatalogFilters,
  locale: AppLocale = "zh-CN"
): MemoryCatalogQuickView[] {
  const t = createTranslator(locale);
  const views: MemoryCatalogQuickView[] = [
    createQuickView(
      filters,
      "global-user",
      t("service.memory.quickGlobalTitle"),
      t("service.memory.quickGlobalDescription"),
      {
        workspaceId: filters.workspaceId,
        memoryViewMode: "workspace_plus_global",
        scope: "user"
      }
    )
  ];

  views.push(
    createQuickView(
      filters,
      "pending-confirmation",
      t("service.memory.quickPendingTitle"),
      t("service.memory.quickPendingDescription"),
      {
        workspaceId: filters.workspaceId,
        memoryViewMode: "workspace_plus_global",
        status: "pending_confirmation"
      }
    )
  );

  if (filters.workspaceId) {
    views.push(
      createQuickView(
        filters,
        "workspace-plus-global",
        t("service.memory.quickWorkspaceGlobalTitle"),
        t("service.memory.quickWorkspaceGlobalDescription"),
        {
          workspaceId: filters.workspaceId,
          memoryViewMode: "workspace_plus_global"
        }
      ),
      createQuickView(
        filters,
        "workspace-only",
        t("service.memory.quickWorkspaceOnlyTitle"),
        t("service.memory.quickWorkspaceOnlyDescription"),
        {
          workspaceId: filters.workspaceId,
          memoryViewMode: "workspace_only"
        }
      )
    );
  }

  if (filters.sourceRef) {
    views.push(
      createQuickView(
        filters,
        "turn-related",
        t("service.memory.quickTurnRelatedTitle"),
        t("service.memory.quickTurnRelatedDescription"),
        {
          workspaceId: filters.workspaceId,
          sourceRef: filters.sourceRef,
          memoryViewMode: "workspace_plus_global"
        }
      )
    );
  }

  if (filters.sessionId) {
    views.push(
      createQuickView(
        filters,
        "clear-session",
        t("service.memory.quickClearSessionTitle"),
        t("service.memory.quickClearSessionDescription"),
        {
          workspaceId: filters.workspaceId,
          memoryViewMode: "workspace_plus_global",
          sourceRef: filters.sourceRef
        }
      )
    );
  }

  return views;
}

export function describeCatalogFilterHints(filters: MemoryCatalogFilters, locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);
  const hints: string[] = [];

  if (filters.sessionId) {
    hints.push(t("service.memory.sessionFilterHint"));
  }

  if (!filters.workspaceId) {
    if (filters.scope === "user" || isImplicitGlobalView(filters)) {
      hints.push(t("service.memory.platformNoWorkspaceHint"));
    } else {
      hints.push(t("service.memory.missingWorkspaceHint"));
    }
  }

  return hints;
}

export function describeCatalogEmptyState(response: MemoryCatalogResponse, locale: AppLocale = "zh-CN") {
  const t = createTranslator(locale);

  if (response.sourceStatus.status === "unavailable" || response.sourceStatus.status === "timeout") {
    return {
      title: t("service.memory.sourceUnavailableTitle"),
      description:
        response.sourceStatus.detail ??
        t("service.memory.sourceUnavailableDescription")
    };
  }

  if (response.sourceStatus.status === "misconfigured") {
    return {
      title: t("service.memory.sourceMisconfiguredTitle"),
      description:
        response.sourceStatus.detail ??
        t("service.memory.sourceMisconfiguredDescription")
    };
  }

  return {
    title: t("service.memory.emptyTitle"),
    description:
      response.appliedFilters.memoryViewMode === "workspace_only"
        ? t("service.memory.emptyWorkspaceOnly")
        : t("service.memory.emptyWorkspaceGlobal")
  };
}
