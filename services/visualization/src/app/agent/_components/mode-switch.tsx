"use client";

import React from "react";
import { useAgentI18n } from "../_i18n/provider";
import type { AgentMemoryMode } from "../_lib/openapi-types";

type ModeSwitchProps = {
  value: AgentMemoryMode;
  onChange(value: AgentMemoryMode): void;
};

export function ModeSwitch({ value, onChange }: ModeSwitchProps) {
  const { formatMemoryModeLabel, t } = useAgentI18n();

  return (
    <div className="flex min-h-11 items-center gap-3 rounded-[var(--radius-pill)] border border-[var(--hairline)] bg-[var(--canvas)] px-4 py-2 text-[14px] leading-[1.43] text-[var(--ink-muted-80)]">
      <span className="font-semibold text-[var(--ink)]">{t("modeSwitch.label")}</span>
      <div className="segment-control !p-0.5" data-testid="memory-mode-select">
        {(["workspace_plus_global", "workspace_only"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className={`segment-item !min-h-8 !px-3 !py-1 !text-[12px] ${
              value === mode ? "segment-item-active" : ""
            }`}
          >
            {formatMemoryModeLabel(mode)}
          </button>
        ))}
      </div>
    </div>
  );
}
