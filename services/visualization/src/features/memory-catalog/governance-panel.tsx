"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { MemoryCatalogDetail, MemoryStatus, Scope } from "@/lib/contracts";

type GovernanceAction = "confirm" | "invalidate" | "archive" | "delete";

type GovernancePanelProps = {
  detail: MemoryCatalogDetail;
};

const actionLabels: Record<GovernanceAction, string> = {
  confirm: "确认",
  invalidate: "失效",
  archive: "归档",
  delete: "删除"
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
      throw new Error(payload?.error?.message ?? payload?.message ?? "请求失败。");
    }

    return payload;
  }

  async function submitAction(action: GovernanceAction) {
    clearFeedback();

    if (reason.trim().length === 0) {
      setError("请先填写原因，再执行治理动作。");
      return;
    }

    try {
      const payload = await requestJson(
        `/api/memories/${encodeURIComponent(detail.id)}/${action}`,
        "POST",
        { reason: reason.trim() }
      );

      setMessage(payload?.message ?? `${actionLabels[action]} 已提交。`);
      markRefreshPending();
      startTransition(() => router.refresh());
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : `${actionLabels[action]} 执行失败。`
      );
    }
  }

  async function submitEdit() {
    clearFeedback();

    if (reason.trim().length === 0) {
      setError("请先填写原因，再编辑这条记忆。");
      return;
    }

    try {
      const payload = await requestJson(`/api/memories/${encodeURIComponent(detail.id)}`, "PATCH", {
        reason: reason.trim(),
        summary: summary.trim(),
        scope,
        status
      });

      setMessage(payload?.message ?? "编辑已提交。");
      markRefreshPending();
      startTransition(() => router.refresh());
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "编辑失败。");
    }
  }

  async function submitRestoreVersion() {
    clearFeedback();

    if (reason.trim().length === 0) {
      setError("请先填写原因，再恢复版本。");
      return;
    }

    if (versionId.trim().length === 0) {
      setError("请填写要恢复的版本号。");
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

      setMessage(payload?.message ?? "版本恢复已提交。");
      markRefreshPending();
      startTransition(() => router.refresh());
    } catch (submissionError) {
      setError(
        submissionError instanceof Error ? submissionError.message : "版本恢复失败。"
      );
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">治理</p>
          <h2 className="font-[var(--font-serif)] text-2xl text-slate-900">最小治理动作</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            先填写原因，再对这条记忆执行确认、失效、归档、删除、编辑或版本恢复。
          </p>
        </div>
      </div>
      <div className="panel-body space-y-6">
        {pendingActionAt ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-900">
            治理请求已提交，读模型可能还在刷新。页面会在 10 秒内自动再刷新一次。
          </div>
        ) : null}
        <label className="grid gap-2">
          <span className="text-sm font-medium text-slate-700">原因</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900"
            placeholder="说明为什么需要执行这次治理动作。"
          />
        </label>

        <div className="space-y-3">
          <div className="text-sm font-semibold text-slate-900">快捷动作</div>
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
            <div className="text-sm font-semibold text-slate-900">编辑</div>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">摘要</span>
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                rows={3}
                className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">作用域</span>
                <select
                  value={scope}
                  onChange={(event) => setScope(event.target.value as Scope)}
                  className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="session">会话</option>
                  <option value="task">任务</option>
                  <option value="workspace">工作区</option>
                  <option value="user">全局</option>
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">状态</span>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as MemoryStatus)}
                  className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="active">生效中</option>
                  <option value="pending_confirmation">待确认</option>
                  <option value="superseded">已被替代</option>
                  <option value="archived">已归档</option>
                </select>
              </label>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void submitEdit()}
              className="rounded-full border bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
            >
              保存编辑
            </button>
          </div>

          <div className="space-y-3 rounded-xl border bg-white/80 p-4">
            <div className="text-sm font-semibold text-slate-900">恢复版本</div>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-slate-700">版本号</span>
              <input
                value={versionId}
                onChange={(event) => setVersionId(event.target.value)}
                className="rounded-xl border bg-white px-3 py-2 text-sm text-slate-900"
                placeholder="例如 3"
              />
            </label>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void submitRestoreVersion()}
              className="rounded-full border bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-60"
            >
              恢复版本
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
