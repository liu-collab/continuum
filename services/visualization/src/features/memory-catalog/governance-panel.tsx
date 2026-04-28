"use client";

import { useRouter } from "next/navigation";
import React from "react";
import { useState, useTransition } from "react";

import { ConfirmAction } from "@/components/confirm-action";
import { SelectField } from "@/components/select-field";
import { MemoryCatalogDetail, MemoryStatus, Scope } from "@/lib/contracts";
import { useAppI18n } from "@/lib/i18n/client";

type GovernanceAction = "confirm" | "invalidate" | "archive" | "delete";
const destructiveActions = new Set<GovernanceAction>(["invalidate", "archive", "delete"]);

type GovernancePanelProps = {
  detail: MemoryCatalogDetail;
};

export function GovernancePanel({ detail }: GovernancePanelProps) {
  const router = useRouter();
  const { t } = useAppI18n();
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState(detail.summary);
  const [scope, setScope] = useState<Scope>(detail.scope);
  const [status, setStatus] = useState<MemoryStatus>(detail.status);
  const [versionId, setVersionId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingActionAt, setPendingActionAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function clearFeedback() {
    setMessage(null);
    setError(null);
  }

  function markRefreshPending() {
    setPendingActionAt(new Date().toISOString());

    window.setTimeout(() => {
      startTransition(() => router.refresh());
    }, 10_000);
  }

  async function requestJson(url: string, method: "POST" | "PATCH", body: Record<string, unknown>) {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const payload = (await response.json().catch(() => null)) as
      | { message?: string; error?: { code?: string; message?: string } }
      | null;

    if (!response.ok) {
      throw new Error(payload?.error?.message ?? payload?.message ?? t("memories.governancePanel.errors.requestFailed"));
    }

    return payload;
  }

  async function submitAction(action: GovernanceAction) {
    clearFeedback();

    if (reason.trim().length === 0) {
      setError(t("memories.governancePanel.errors.reasonRequiredAction"));
      return;
    }

    try {
      const payload = await requestJson(
        `/api/memories/${encodeURIComponent(detail.id)}/${action}`,
        "POST",
        { reason: reason.trim() }
      );

      setMessage(payload?.message ?? t("memories.governancePanel.submitted.action", {
        action: t(`memories.governancePanel.actions.${action}`)
      }));
      markRefreshPending();
      startTransition(() => router.refresh());
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : t("memories.governancePanel.errors.actionFailed", {
              action: t(`memories.governancePanel.actions.${action}`)
            })
      );
    }
  }

  async function submitEdit() {
    clearFeedback();

    if (reason.trim().length === 0) {
      setError(t("memories.governancePanel.errors.reasonRequiredEdit"));
      return;
    }

    try {
      const payload = await requestJson(`/api/memories/${encodeURIComponent(detail.id)}`, "PATCH", {
        reason: reason.trim(),
        summary: summary.trim(),
        scope,
        status
      });

      setMessage(payload?.message ?? t("memories.governancePanel.submitted.edit"));
      markRefreshPending();
      startTransition(() => router.refresh());
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : t("memories.governancePanel.errors.editFailed"));
    }
  }

  async function submitRestoreVersion() {
    clearFeedback();

    if (reason.trim().length === 0) {
      setError(t("memories.governancePanel.errors.reasonRequiredRestore"));
      return;
    }

    if (versionId.trim().length === 0) {
      setError(t("memories.governancePanel.errors.versionRequired"));
      return;
    }

    try {
      const payload = await requestJson(
        `/api/memories/${encodeURIComponent(detail.id)}/restore-version`,
        "POST",
        {
          reason: reason.trim(),
          versionId: versionId.trim()
        }
      );

      setMessage(payload?.message ?? t("memories.governancePanel.submitted.restore"));
      markRefreshPending();
      startTransition(() => router.refresh());
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : t("memories.governancePanel.errors.restoreFailed"));
    }
  }

  return (
    <div className="panel p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="section-kicker">{t("memories.governancePanel.title")}</div>
          <p className="mt-2 text-[17px] leading-[1.47] text-muted">
            {t("memories.governancePanel.description")}
          </p>
        </div>
      </div>

      {pendingActionAt ? (
        <div className="notice notice-warning mt-3">
          {t("memories.governancePanel.pendingRefresh")}
        </div>
      ) : null}

      <label className="mt-4 block">
        <span className="text-[14px] font-semibold leading-[1.29] text-muted-foreground">{t("memories.governancePanel.reason")}</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          className="field mt-1"
          placeholder={t("memories.governancePanel.reasonPlaceholder")}
        />
      </label>

      <div className="mt-4">
        <div className="section-kicker">{t("memories.governancePanel.quickActions")}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["confirm", "invalidate", "archive", "delete"] as GovernanceAction[]).map((action) => (
            destructiveActions.has(action) ? (
              <ConfirmAction
                key={action}
                disabled={isPending}
                title={t("memories.governancePanel.confirmAction.title", {
                  action: t(`memories.governancePanel.actions.${action}`)
                })}
                description={t("memories.governancePanel.confirmAction.description", {
                  action: t(`memories.governancePanel.actions.${action}`)
                })}
                confirmLabel={t("memories.governancePanel.confirmAction.confirm")}
                cancelLabel={t("memories.governancePanel.confirmAction.cancel")}
                onConfirm={() => submitAction(action)}
                variant={action === "delete" ? "destructive" : "default"}
                testId={`memory-governance-${action}`}
                trigger={t(`memories.governancePanel.actions.${action}`)}
              />
            ) : (
              <button
                key={action}
                type="button"
                disabled={isPending}
                onClick={() => void submitAction(action)}
                className="btn-outline"
              >
                {t(`memories.governancePanel.actions.${action}`)}
              </button>
            )
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="record-card space-y-3">
          <div className="section-kicker">{t("memories.governancePanel.edit")}</div>
          <label className="block">
            <span className="text-[14px] text-muted-foreground">{t("memories.governancePanel.summary")}</span>
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={2}
              className="field mt-1"
            />
          </label>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="block">
              <span className="text-[14px] text-muted-foreground">{t("memories.fields.scope")}</span>
              <div className="mt-1">
                <SelectField
                  value={scope}
                  onChange={(value) => setScope(value as Scope)}
                  options={[
                    { value: "session", label: t("enums.scope.session") },
                    { value: "task", label: t("enums.scope.task") },
                    { value: "workspace", label: t("enums.scope.workspace") },
                    { value: "user", label: t("enums.scope.user") }
                  ]}
                />
              </div>
            </label>
            <label className="block">
              <span className="text-[14px] text-muted-foreground">{t("memories.fields.status")}</span>
              <div className="mt-1">
                <SelectField
                  value={status}
                  onChange={(value) => setStatus(value as MemoryStatus)}
                  options={[
                    { value: "active", label: t("enums.memoryStatus.active") },
                    { value: "pending_confirmation", label: t("enums.memoryStatus.pending_confirmation") },
                    { value: "superseded", label: t("enums.memoryStatus.superseded") },
                    { value: "archived", label: t("enums.memoryStatus.archived") }
                  ]}
                />
              </div>
            </label>
          </div>
          <button
            type="button"
            disabled={isPending}
            onClick={() => void submitEdit()}
            className="btn-outline mt-1"
          >
            {t("memories.governancePanel.saveEdit")}
          </button>
        </div>

        <div className="record-card space-y-3">
          <div className="section-kicker">{t("memories.governancePanel.restoreVersion")}</div>
          <label className="block">
            <span className="text-[14px] text-muted-foreground">{t("memories.governancePanel.versionId")}</span>
            <input
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
              className="field mt-1"
              placeholder={t("memories.governancePanel.versionPlaceholder")}
            />
          </label>
          <button
            type="button"
            disabled={isPending}
            onClick={() => void submitRestoreVersion()}
            className="btn-outline mt-1"
          >
            {t("memories.governancePanel.restoreVersion")}
          </button>
        </div>
      </div>

      {message ? (
        <div className="notice mt-4">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="notice notice-danger mt-4">
          {error}
        </div>
      ) : null}
    </div>
  );
}
