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

function healthTone(health: ServiceHealthResponse | undefined, sources: SourceStatus[] | undefined) {
  if (health) {
    if (health.readiness.status === "ready") return "success";
    return "warning";
  }
  if (!sources || sources.length === 0) {
    return "neutral";
  }
  if (sources?.some((item) => ["unavailable", "timeout", "misconfigured"].includes(item.status))) {
    return "danger";
  }
  if (sources?.some((item) => item.status === "partial")) return "warning";
  return "success";
}

const toneDot: Record<HealthTone, string> = {
  neutral: "bg-zinc-400",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500"
};

export function HealthModalButton(props: HealthModalButtonProps) {
  const [open, setOpen] = useState(false);
  const tone = healthTone(props.health, props.sources);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-outline">
        <span className={`h-2 w-2 rounded-full ${toneDot[tone]}`} />
        <HeartPulse className="h-4 w-4" />
        {props.label ?? "健康"}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={props.label ?? "服务与依赖健康"}
        size="xl"
      >
        {props.health ? (
          <SourceHealthPanel health={props.health} />
        ) : (
          <SourceHealthPanel sources={props.sources!} />
        )}
      </Modal>
    </>
  );
}
