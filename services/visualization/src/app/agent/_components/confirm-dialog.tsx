"use client";

"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";

import { useAgentI18n } from "../_i18n/provider";
import type { AgentPendingConfirm, AgentPendingPlanConfirm } from "../_lib/event-reducer";

type ConfirmDialogProps = {
  pendingConfirm: AgentPendingConfirm | AgentPendingPlanConfirm | null;
  onDecision(decision: "allow" | "deny" | "allow_session" | "approve" | "revise" | "cancel"): void;
};

export function ConfirmDialog({ pendingConfirm, onDecision }: ConfirmDialogProps) {
  const { t } = useAgentI18n();

  if (!pendingConfirm) {
    return null;
  }

  if (pendingConfirm.kind === "plan") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4">
        <div
          data-testid="plan-confirm-dialog"
          className="w-full max-w-xl rounded-lg border bg-surface p-5 shadow-overlay"
        >
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-amber-100 p-1.5 text-amber-700">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-semibold text-foreground">确认计划</div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                当前轮先生成了执行计划，确认后才会继续执行。
              </p>
              <div className="mt-3 rounded-md border bg-surface-muted/40 px-3 py-2 text-xs leading-5 text-foreground">
                <div>{pendingConfirm.plan.goal}</div>
                <div className="mt-2 space-y-1">
                  {pendingConfirm.plan.steps.map((step) => (
                    <div key={step.id}>
                      {step.status} · {step.title}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => onDecision("cancel")}
              data-testid="plan-confirm-cancel"
              className="btn-outline"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => onDecision("revise")}
              data-testid="plan-confirm-revise"
              className="btn-outline"
            >
              先修订
            </button>
            <button
              type="button"
              onClick={() => onDecision("approve")}
              data-testid="plan-confirm-approve"
              className="btn-primary"
            >
              确认继续
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4">
      <div
        data-testid="tool-confirm-dialog"
        className="w-full max-w-xl rounded-lg border bg-surface p-5 shadow-overlay"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-amber-100 p-1.5 text-amber-700">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-base font-semibold text-foreground">{t("confirmDialog.title")}</div>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {t("confirmDialog.description", { tool: pendingConfirm.tool })}
            </p>
            <div className="mt-3 rounded-md border bg-surface-muted/40 px-3 py-2 text-xs leading-5 text-foreground">
              {pendingConfirm.paramsPreview}
            </div>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => onDecision("deny")}
            data-testid="confirm-deny"
            className="btn-outline"
          >
            {t("confirmDialog.deny")}
          </button>
          <button
            type="button"
            onClick={() => onDecision("allow")}
            data-testid="confirm-allow"
            className="btn-outline"
          >
            {t("confirmDialog.allow")}
          </button>
          <button
            type="button"
            onClick={() => onDecision("allow_session")}
            data-testid="confirm-allow-session"
            className="btn-primary"
          >
            {t("confirmDialog.allowSession")}
          </button>
        </div>
      </div>
    </div>
  );
}
