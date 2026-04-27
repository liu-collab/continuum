"use client";

import React, { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  tone: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
  className?: string;
};

const styles: Record<StatusBadgeProps["tone"], string> = {
  neutral: "bg-surface-hover text-muted border border-border",
  success: "bg-emerald-bg text-emerald border border-emerald-900/30",
  warning: "bg-amber-bg text-amber border border-amber-900/30",
  danger: "bg-rose-bg text-rose border border-rose-900/30"
};

export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[3px] px-1.5 py-0.5 text-[11px] font-[var(--font-mono)] font-medium",
        styles[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
