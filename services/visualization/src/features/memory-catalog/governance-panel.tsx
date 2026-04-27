"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { SelectField } from "@/components/select-field";
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
      setError(submissionError instanceof Error ? submissionError.message : "版本恢复失败。");
    }
  }

  return (
    <div className="panel p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="section-kicker">治理</div>
          <p className="mt-2 text-[17px] leading-[1.47] text-muted">
            填写原因后执行动作。
          </p>
        </div>
      </div>

      {pendingActionAt ? (
        <div className="notice notice-warning mt-3">
          已提交，读模型刷新中，10 秒后自动再刷新。
        </div>
      ) : null}

      <label className="mt-4 block">
        <span className="text-[14px] font-semibold leading-[1.29] text-muted-foreground">原因</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          className="field mt-1"
          placeholder="说明为什么需要执行这次治理动作。"
        />
      </label>

      <div className="mt-4">
        <div className="section-kicker">快捷动作</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["confirm", "invalidate", "archive", "delete"] as GovernanceAction[]).map((action) => (
            <button
              key={action}
              type="button"
              disabled={isPending}
              onClick={() => void submitAction(action)}
              className="btn-outline"
            >
              {actionLabels[action]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="record-card space-y-3">
          <div className="section-kicker">编辑</div>
          <label className="block">
            <span className="text-[14px] text-muted-foreground">摘要</span>
            <textarea
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              rows={2}
              className="field mt-1"
            />
          </label>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="block">
              <span className="text-[14px] text-muted-foreground">作用域</span>
              <div className="mt-1">
                <SelectField
                  value={scope}
                  onChange={(value) => setScope(value as Scope)}
                  options={[
                    { value: "session", label: "会话" },
                    { value: "task", label: "任务" },
                    { value: "workspace", label: "工作区" },
                    { value: "user", label: "平台" }
                  ]}
                />
              </div>
            </label>
            <label className="block">
              <span className="text-[14px] text-muted-foreground">状态</span>
              <div className="mt-1">
                <SelectField
                  value={status}
                  onChange={(value) => setStatus(value as MemoryStatus)}
                  options={[
                    { value: "active", label: "生效中" },
                    { value: "pending_confirmation", label: "待确认" },
                    { value: "superseded", label: "已被替代" },
                    { value: "archived", label: "已归档" }
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
            保存编辑
          </button>
        </div>

        <div className="record-card space-y-3">
          <div className="section-kicker">恢复版本</div>
          <label className="block">
            <span className="text-[14px] text-muted-foreground">版本号</span>
            <input
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
              className="field mt-1"
              placeholder="例如 3"
            />
          </label>
          <button
            type="button"
            disabled={isPending}
            onClick={() => void submitRestoreVersion()}
            className="btn-outline mt-1"
          >
            恢复版本
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
