"use client";

import { X } from "lucide-react";
import React, { ReactNode, useEffect } from "react";
import { cn } from "@/lib/utils";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-10"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "flex max-h-full w-full flex-col overflow-hidden border border-border bg-surface shadow-overlay",
          "rounded-lg",
          sizeClass[size]
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="text-[15px] font-[var(--font-mono)] font-medium text-text">
              {title}
            </div>
            {description ? (
              <div className="mt-1 text-[13px] text-muted">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted transition hover:bg-surface-hover hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-hover/40 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
