"use client";

import { useAgentI18n } from "../_i18n/provider";
import type { AgentMemoryMode } from "../_lib/openapi-types";

type ModeSwitchProps = {
  value: AgentMemoryMode;
  onChange(value: AgentMemoryMode): void;
};

export function ModeSwitch({ value, onChange }: ModeSwitchProps) {
  const { formatMemoryModeLabel, t } = useAgentI18n();

  return (
    <label className="flex items-center gap-3 rounded-full border bg-white/85 px-4 py-2 text-sm text-slate-700">
      <span className="font-semibold text-slate-900">{t("modeSwitch.label")}</span>
      <select
        data-testid="memory-mode-select"
        value={value}
        onChange={(event) => onChange(event.target.value as AgentMemoryMode)}
        className="bg-transparent text-sm outline-none"
      >
        <option value="workspace_plus_global">{formatMemoryModeLabel("workspace_plus_global")}</option>
        <option value="workspace_only">{formatMemoryModeLabel("workspace_only")}</option>
      </select>
    </label>
  );
}
