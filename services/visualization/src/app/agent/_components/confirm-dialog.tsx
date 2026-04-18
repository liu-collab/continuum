"use client";

import { AlertTriangle } from "lucide-react";

import type { AgentPendingConfirm } from "../_lib/event-reducer";

type ConfirmDialogProps = {
  pendingConfirm: AgentPendingConfirm | null;
  onDecision(decision: "allow" | "deny" | "allow_session"): void;
};

export function ConfirmDialog({ pendingConfirm, onDecision }: ConfirmDialogProps) {
  if (!pendingConfirm) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/25 px-4">
      <div data-testid="tool-confirm-dialog" className="w-full max-w-xl rounded-3xl border bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-amber-100 p-2 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="text-lg font-semibold text-slate-900">需要权限确认</div>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              工具 <span className="font-semibold text-slate-900">{pendingConfirm.tool}</span> 请求执行。
              这一步需要你确认后才会继续。
            </p>
            <div className="mt-4 rounded-2xl border bg-slate-50 px-4 py-3 text-xs leading-6 text-slate-700">
              {pendingConfirm.paramsPreview}
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="button"
            onClick={() => onDecision("deny")}
            data-testid="confirm-deny"
            className="rounded-full border px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            拒绝
          </button>
          <button
            type="button"
            onClick={() => onDecision("allow")}
            data-testid="confirm-allow"
            className="rounded-full border border-accent px-4 py-2 text-sm font-semibold text-accent transition hover:bg-accent/5"
          >
            允许
          </button>
          <button
            type="button"
            onClick={() => onDecision("allow_session")}
            data-testid="confirm-allow-session"
            className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95"
          >
            本会话始终允许
          </button>
        </div>
      </div>
    </div>
  );
}
