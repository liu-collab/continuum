import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type DetailRowTone = "neutral" | "success" | "warning" | "danger";

const toneClasses: Record<DetailRowTone, string> = {
  neutral: "",
  success: "text-[var(--primary)]",
  warning: "text-[var(--ink-muted-48)]",
  danger: "text-[var(--ink)]"
};

export function DetailRow({
  label,
  value,
  tone = "neutral"
}: {
  label: string;
  value: ReactNode;
  tone?: DetailRowTone;
}) {
  return (
    <div className="kv-row">
      <dt className="kv-label">{label}</dt>
      <dd className={cn("kv-value", toneClasses[tone])}>{value}</dd>
    </div>
  );
}
