"use client";

import React, { type ReactNode, useId, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

type ConfirmActionProps = {
  trigger: ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm(): Promise<void> | void;
  disabled?: boolean;
  variant?: "default" | "destructive";
  testId?: string;
};

export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  disabled = false,
  variant = "default",
  testId = "confirm-action"
}: ConfirmActionProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setSubmitting(true);

    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="btn-outline"
        data-testid={`${testId}-trigger`}
      >
        {trigger}
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4"
          data-testid={`${testId}-backdrop`}
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full max-w-lg rounded-[var(--radius-lg)] border border-border bg-surface p-5 outline-none"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className={`shrink-0 rounded-[var(--radius-sm)] p-1.5 ${
                  variant === "destructive"
                    ? "bg-[var(--canvas-parchment)] text-[var(--ink)]"
                    : "bg-[var(--surface-pearl)] text-[var(--primary)]"
                }`}
              >
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h3 id={titleId} className="headline-display text-[21px] font-semibold leading-[1.19] text-text">
                  {title}
                </h3>
                <p id={descriptionId} className="mt-2 text-[14px] leading-[1.43] text-muted">
                  {description}
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {submitting ? (
                <div role="status" className="mr-auto flex min-h-9 items-center gap-2 text-[14px] text-muted">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {confirmLabel}
                </div>
              ) : null}
              <button
                type="button"
                className="btn-outline"
                disabled={submitting}
                onClick={() => setOpen(false)}
                data-testid={`${testId}-cancel`}
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                className={variant === "destructive" ? "btn-primary" : "btn-outline"}
                disabled={submitting}
                onClick={() => void confirm()}
                data-testid={`${testId}-confirm`}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
