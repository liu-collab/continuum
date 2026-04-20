import React, { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatusBadgeProps = {
  tone: "neutral" | "success" | "warning" | "danger";
  children: ReactNode;
};

export function StatusBadge({ tone, children }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-surface-muted text-muted-foreground",
        tone === "success" && "bg-emerald-50 text-emerald-700",
        tone === "warning" && "bg-amber-50 text-amber-700",
        tone === "danger" && "bg-rose-50 text-rose-700"
      )}
    >
      {children}
    </span>
  );
}
