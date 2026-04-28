"use client";

import { X } from "lucide-react";
import React, { ReactNode, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useAppI18n } from "@/lib/i18n/client";

type ModalProps = {
  open: boolean;
  onClose(): void;
  title: string;
  description?: string;
  size?: "md" | "lg" | "xl";
  children: ReactNode;
  footer?: ReactNode;
};

const sizeClass: Record<NonNullable<ModalProps["size"]>, string> = {
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl"
};

export function Modal({ open, onClose, title, description, size = "md", children, footer }: ModalProps) {
  const { t } = useAppI18n();

  useEffect(() => {
    if (!open) return;
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--modal-backdrop)] px-4 py-10 backdrop-blur-[20px]"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "flex max-h-full w-full flex-col overflow-hidden border border-border bg-surface",
          "rounded-[var(--radius-lg)]",
          sizeClass[size]
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div className="min-w-0">
            <div className="headline-display text-[21px] font-semibold leading-tight text-text">
              {title}
            </div>
            {description ? (
              <div className="mt-1 text-[14px] leading-5 text-muted">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="icon-button !h-11 !w-11"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-3 border-t border-border bg-[var(--canvas-parchment)] px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
