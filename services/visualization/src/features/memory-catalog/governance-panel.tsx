"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { MemoryCatalogDetail, MemoryStatus, Scope } from "@/lib/contracts";

type GovernanceAction = "confirm" | "invalidate" | "archive" | "delete";

type GovernancePanelProps = {
  detail: MemoryCatalogDetail;
};

const actionLabels: Record<GovernanceAction, string> = {
  confirm: "Confirm",
  invalidate: "Invalidate",
  archive: "Archive",
  delete: "Delete"
};

export function GovernancePanel({ detail }: GovernancePanelProps) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [summary, setSummary] = useState(detail.summary);
  const [scope, setScope] = useState<Scope>(detail.scope);
  const [status, setStatus] = useState<MemoryStatus>(detail.status);
  const [versionId, setVersionId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function clearFeedback() {
    setMessage(null);
    setError(null);
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
      throw new Error(payload?.error?.message ?? payload?.message ?? "Request failed.");
    }

    return payload;
  }

  async function submitAction(action: GovernanceAction) {
    clearFeedback();

    if (reason.trim().length === 0) {
      setError("Please provide a reason before submitting a governance action.");
      return;
    }

    try {
      const payload = await requestJson(
        `/api/memories/${encodeURIComponent(detail.id)}/${action}`,
        "POST",
        { reason: reason.trim() }
      );

      setMessage(payload?.message ?? `${actionLabels[action]} completed.`);
      startTransition(() => router.refresh());
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : `${actionLabels[action]} failed.`
      );
    }
  }

  async function submitEdit() {
    clearFeedback();

    if (reason.trim().length === 0) {
      setError("Please provide a reason before editing this memory.");
      return;
    }

    try {
      const payload = await requestJson(`/api/memories/${encodeURIComponent(detail.id)}`, "PATCH", {
        reason: reason.trim(),
        summary: summary.trim(),
        scope,
        status
      });

      setMessage(payload?.message ?? "Edit completed.");
      startTransition(() => router.refresh());
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "Edit failed.");
    }
  }

  async function submitRestoreVersion() {
    clearFeedback();

    if (reason.trim().length === 0) {
      setError("Please provide a reason before restoring a version.");
      return;
    }

    if (versionId.trim().length === 0) {
      setError("Please provide a version number to restore.");
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

      setMessage(payload?.message ?? "Version restore submitted.");
      startTransition(() => router.refresh());
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "Version restore failed."
      );
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Governance</p>
          <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">Minimum actions</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Provide a reason, then confirm, invalidate, archive, delete, edit, or restore a version for this memory.
          </p>
        </div>
      </div>
      <div className="panel-body space-y-6">
        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700">Reason</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900"
            placeholder="Explain why this governance action is needed."
          />
        </label>

        <div className="space-y-3">
          <div className="text-sm font-semibold text-slate-900">Quick actions</div>
          <div className="flex flex-wrap gap-3">
            {(["confirm", "invalidate", "archive", "delete"] as GovernanceAction[]).map((action) => (
              <button
                key={action}
                type="button"
                disabled={isPending}
                onClick={() => void submitAction(action)}
                className="rounded-full border bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
              >
                {actionLabels[action]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-xl border bg-white/80 p-4">
            <div className="text-sm font-semibold text-slate-900">Edit</div>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">Summary</span>
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                rows={3}
                className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">Scope</span>
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as Scope)}
                  className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="session">Session</option>
                  <option value="task">Task</option>
                  <option value="workspace">Workspace</option>
                  <option value="user">Global</option>
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">Status</span>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as MemoryStatus)}
                  className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="active">Active</option>
                  <option value="pending_confirmation">Pending confirmation</option>
                  <option value="superseded">Superseded</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void submitEdit()}
              className="rounded-full border bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
            >
              Save edit
            </button>
          </div>

          <div className="space-y-3 rounded-xl border bg-white/80 p-4">
            <div className="text-sm font-semibold text-slate-900">Restore version</div>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">Version number</span>
              <input
                value={versionId}
                onChange={(event) => setVersionId(event.target.value)}
                className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900"
                placeholder="e.g. 3"
              />
            </label>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void submitRestoreVersion()}
              className="rounded-full border bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
            >
              Restore version
            </button>
          </div>
        </div>

        {message ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-sm text-emerald-900">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-900">
            {error}
          </div>
        ) : null}
      </div>
    </section>
  );
}
