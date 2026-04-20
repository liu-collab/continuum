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
    if (!open) {
      return;
    }

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 px-4 py-10"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "flex max-h-full w-full flex-col overflow-hidden rounded-lg border bg-surface shadow-overlay",
          sizeClass[size]
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="text-base font-semibold text-foreground">{title}</div>
            {description ? (
              <div className="mt-1 text-sm text-muted-foreground">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t bg-surface-muted/50 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
