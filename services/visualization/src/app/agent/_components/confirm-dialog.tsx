"use client";

import { AlertTriangle } from "lucide-react";

import { useAgentI18n } from "../_i18n/provider";
import type { AgentPendingConfirm } from "../_lib/event-reducer";

type ConfirmDialogProps = {
  pendingConfirm: AgentPendingConfirm | null;
  onDecision(decision: "allow" | "deny" | "allow_session"): void;
};

export function ConfirmDialog({ pendingConfirm, onDecision }: ConfirmDialogProps) {
  const { t } = useAgentI18n();

  if (!pendingConfirm) {
    return null;
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
