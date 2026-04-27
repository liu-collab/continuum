"use client";

import { HeartPulse } from "lucide-react";
import { useState } from "react";
import { Modal } from "@/components/modal";
import { SourceHealthPanel } from "@/components/source-health-panel";
import type { ServiceHealthResponse, SourceStatus } from "@/lib/contracts";

type HealthModalButtonProps =
  | { label?: string; health: ServiceHealthResponse; sources?: never }
  | { label?: string; health?: never; sources: SourceStatus[] };

type HealthTone = "neutral" | "success" | "warning" | "danger";

function computeTone(health?: ServiceHealthResponse, sources?: SourceStatus[]): HealthTone {
  if (health) return health.readiness.status === "ready" ? "success" : "warning";
  if (!sources?.length) return "neutral";
  if (sources.some((s) => ["unavailable","timeout","misconfigured"].includes(s.status))) return "danger";
  if (sources.some((s) => s.status === "partial")) return "warning";
  return "success";
}

const dotColor: Record<HealthTone, string> = {
  neutral: "#5c6072",
  success: "#4ade80",
  warning: "var(--amber)",
  danger: "#f87171"
};

export function HealthModalButton(props: HealthModalButtonProps) {
  const [open, setOpen] = useState(false);
  const tone = computeTone(props.health, props.sources);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
          borderRadius: "var(--radius-md)",
          padding: "0.375rem 0.75rem",
          fontSize: "0.8125rem",
          fontFamily: "var(--font-mono)",
          fontWeight: 500,
          color: "var(--text-muted)",
          background: "transparent",
          border: "1px solid var(--border)",
          cursor: "pointer",
          transition: "all 80ms ease"
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor[tone] }} />
        <HeartPulse style={{ width: 16, height: 16, opacity: 0.6 }} />
        {props.label ?? "Status"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Service Health" size="xl">
        {props.health ? <SourceHealthPanel health={props.health} /> : <SourceHealthPanel sources={props.sources!} />}
      </Modal>
    </>
  );
}
