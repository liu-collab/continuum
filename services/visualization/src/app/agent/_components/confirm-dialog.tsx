"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";

import { useAgentI18n } from "@/lib/i18n/agent/provider";
import type { AgentPendingConfirm, AgentPendingPlanConfirm } from "../_lib/event-reducer";

type ConfirmDecision = "allow" | "deny" | "allow_session" | "approve" | "revise" | "cancel";

type ConfirmDialogProps = {
  pendingConfirm: AgentPendingConfirm | AgentPendingPlanConfirm | null;
  onDecision(decision: ConfirmDecision, feedback?: string): void;
};

export function ConfirmDialog({ pendingConfirm, onDecision }: ConfirmDialogProps) {
  const { t } = useAgentI18n();
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const decisionSubmittedRef = useRef(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [decisionSubmitted, setDecisionSubmitted] = useState(false);
  const dismissDecision = pendingConfirm?.kind === "plan" ? "cancel" : "deny";

  useEffect(() => {
    setRevisionFeedback("");
    setDecisionSubmitted(false);
    decisionSubmittedRef.current = false;
  }, [pendingConfirm?.confirmId]);

  const submitDecision = useCallback(
    (decision: ConfirmDecision, feedback?: string) => {
      if (decisionSubmittedRef.current) {
        return;
      }

      decisionSubmittedRef.current = true;
      setDecisionSubmitted(true);

      try {
        if (feedback === undefined) {
          onDecision(decision);
        } else {
          onDecision(decision, feedback);
        }
      } catch (error) {
        decisionSubmittedRef.current = false;
        setDecisionSubmitted(false);
        throw error;
      }
    },
    [onDecision]
  );

  useEffect(() => {
    if (!pendingConfirm) {
      return;
    }

    const previouslyFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    initialFocusRef.current?.focus();
    if (!initialFocusRef.current) {
      dialogRef.current?.focus();
    }

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        submitDecision(dismissDecision);
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = getFocusableElements(dialogRef.current);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);
      const activeElement = document.activeElement;

      if (event.shiftKey && (activeElement === firstElement || !dialogRef.current.contains(activeElement))) {
        event.preventDefault();
        lastElement?.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
      previouslyFocusedElement?.focus();
    };
  }, [dismissDecision, pendingConfirm, submitDecision]);

  if (!pendingConfirm) {
    return null;
  }

  const dismiss = () => submitDecision(dismissDecision);
  const revisePlan = () => submitDecision("revise", revisionFeedback.trim() || undefined);
  const submittingStatus = decisionSubmitted ? (
    <div
      role="status"
      data-testid="confirm-submitting"
      className="mr-auto flex min-h-9 items-center gap-2 text-xs text-muted-foreground"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      {t("confirmDialog.submitting")}
    </div>
  ) : null;

  if (pendingConfirm.kind === "plan") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4"
        data-testid="plan-confirm-backdrop"
        onClick={dismiss}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          data-testid="plan-confirm-dialog"
          onClick={(event) => event.stopPropagation()}
          className="w-full max-w-xl rounded-lg border bg-surface p-5 outline-none"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="shrink-0 rounded-[var(--radius-md)] bg-[var(--surface-pearl)] p-1.5 text-[var(--primary)]">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div id={titleId} className="text-base font-semibold text-foreground">
                  {t("confirmDialog.planTitle")}
                </div>
                <p id={descriptionId} className="mt-1 text-sm leading-6 text-muted-foreground">
                  {t("confirmDialog.planDescription")}
                </p>
                <div className="mt-3 max-h-60 overflow-auto rounded-md border bg-surface-muted/40 px-3 py-2 text-xs leading-5 text-foreground">
                  <div className="break-words">{pendingConfirm.plan.goal}</div>
                  <div className="mt-2 space-y-1">
                    {pendingConfirm.plan.steps.map((step) => (
                      <div key={step.id} className="break-words">
                        {step.status} · {step.title}
                      </div>
                    ))}
                  </div>
                </div>
                <label className="mt-3 block text-xs font-semibold text-muted-foreground" htmlFor={`${descriptionId}-feedback`}>
                  {t("confirmDialog.revisionFeedback")}
                </label>
                <textarea
                  id={`${descriptionId}-feedback`}
                  value={revisionFeedback}
                  onChange={(event) => setRevisionFeedback(event.target.value)}
                  placeholder={t("confirmDialog.revisionFeedbackPlaceholder")}
                  data-testid="plan-confirm-feedback"
                  className="mt-1 min-h-20 w-full resize-y rounded-md border bg-surface px-3 py-2 text-sm leading-6 text-foreground outline-none transition focus:border-accent"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              aria-label={t("confirmDialog.close")}
              data-testid="plan-confirm-close"
              className="shrink-0 rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {submittingStatus}
            <button
              type="button"
              onClick={() => submitDecision("cancel")}
              disabled={decisionSubmitted}
              data-testid="plan-confirm-cancel"
              className="btn-outline disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("confirmDialog.planCancel")}
            </button>
            <button
              type="button"
              onClick={revisePlan}
              disabled={decisionSubmitted}
              data-testid="plan-confirm-revise"
              className="btn-outline disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("confirmDialog.planRevise")}
            </button>
            <button
              ref={initialFocusRef}
              type="button"
              onClick={() => submitDecision("approve")}
              disabled={decisionSubmitted}
              data-testid="plan-confirm-approve"
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("confirmDialog.planApprove")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4"
      data-testid="tool-confirm-backdrop"
      onClick={dismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        data-testid="tool-confirm-dialog"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-xl rounded-lg border bg-surface p-5 outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="shrink-0 rounded-[var(--radius-md)] bg-[var(--surface-pearl)] p-1.5 text-[var(--primary)]">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div id={titleId} className="text-base font-semibold text-foreground">
                {t("confirmDialog.title")}
              </div>
              <p id={descriptionId} className="mt-1 text-sm leading-6 text-muted-foreground">
                {t("confirmDialog.description", { tool: pendingConfirm.tool })}
              </p>
              {pendingConfirm.riskHint ? (
                <div
                  data-testid="confirm-risk-hint"
                  className="mt-2 inline-flex max-w-full items-center rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface-pearl)] px-2 py-1 text-xs font-semibold text-muted-foreground"
                >
                  {t("confirmDialog.riskHint", {
                    risk: t(`confirmDialog.risk.${pendingConfirm.riskHint}`)
                  })}
                </div>
              ) : null}
              <div className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-surface-muted/40 px-3 py-2 text-xs leading-5 text-foreground">
                {pendingConfirm.paramsPreview}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("confirmDialog.close")}
            data-testid="confirm-close"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {submittingStatus}
          <button
            ref={initialFocusRef}
            type="button"
            onClick={() => submitDecision("deny")}
            disabled={decisionSubmitted}
            data-testid="confirm-deny"
            className="btn-outline disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("confirmDialog.deny")}
          </button>
          <button
            type="button"
            onClick={() => submitDecision("allow")}
            disabled={decisionSubmitted}
            data-testid="confirm-allow"
            className="btn-outline disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("confirmDialog.allow")}
          </button>
          <button
            type="button"
            onClick={() => submitDecision("allow_session")}
            disabled={decisionSubmitted}
            data-testid="confirm-allow-session"
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("confirmDialog.allowSession")}
          </button>
        </div>
      </div>
    </div>
  );
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        "a[href]",
        "button:not([disabled])",
        "textarea:not([disabled])",
        "input:not([disabled])",
        "select:not([disabled])",
        "[tabindex]:not([tabindex='-1'])"
      ].join(", ")
    )
  ).filter((element) => element.offsetParent !== null || element === document.activeElement);
}
