import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  tone: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
  className?: string;
};

const styles: Record<StatusBadgeProps["tone"], string> = {
  neutral: "status-badge",
  success: "status-badge status-success",
  warning: "status-badge status-warning",
  danger: "status-badge status-danger"
};

export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        styles[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
