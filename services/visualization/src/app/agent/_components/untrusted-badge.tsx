"use client";

import React from "react";

import { StatusBadge } from "@/components/status-badge";

import { useAgentI18n } from "@/lib/i18n/agent/provider";
import type { AgentToolTrustLevel } from "../_lib/openapi-types";

type UntrustedBadgeProps = {
  trustLevel: AgentToolTrustLevel | null;
};

export function UntrustedBadge({ trustLevel }: UntrustedBadgeProps) {
  const { formatTrustLevelLabel } = useAgentI18n();

  if (!trustLevel) {
    return null;
  }

  const tone =
    trustLevel === "builtin_read"
      ? "neutral"
      : trustLevel === "builtin_write"
        ? "warning"
        : "danger";

  return <StatusBadge tone={tone}>{formatTrustLevelLabel(trustLevel)}</StatusBadge>;
}
