"use client";

import { StatusBadge } from "@/components/status-badge";

import type { AgentToolTrustLevel } from "../_lib/openapi-types";

type UntrustedBadgeProps = {
  trustLevel: AgentToolTrustLevel | null;
};

export function UntrustedBadge({ trustLevel }: UntrustedBadgeProps) {
  if (!trustLevel) {
    return null;
  }

  const tone =
    trustLevel === "builtin_read"
      ? "neutral"
      : trustLevel === "builtin_write"
        ? "warning"
        : "danger";

  return <StatusBadge tone={tone}>{trustLevel}</StatusBadge>;
}
