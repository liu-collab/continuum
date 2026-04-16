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
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tone === "neutral" && "bg-slate-200 text-slate-700",
        tone === "success" && "bg-emerald-100 text-emerald-700",
        tone === "warning" && "bg-amber-100 text-amber-700",
        tone === "danger" && "bg-rose-100 text-rose-700"
      )}
    >
      {children}
    </span>
  );
}
