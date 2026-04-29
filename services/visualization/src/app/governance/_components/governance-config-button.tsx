"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { useAppI18n } from "@/lib/i18n/client";
import type { MnaRuntimeGovernanceConfig } from "@/app/agent/_lib/openapi-types";

type GovernanceConfigEditorProps = {
  config: MnaRuntimeGovernanceConfig | null;
  label: string;
};

const defaultConfig: MnaRuntimeGovernanceConfig = {
  WRITEBACK_MAINTENANCE_ENABLED: false,
  WRITEBACK_MAINTENANCE_INTERVAL_MS: 900_000,
  WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
  WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
  WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10
};

function resolveConfig(config: MnaRuntimeGovernanceConfig | null) {
  return config ?? defaultConfig;
}

function readErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === "object") {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  }

  return fallback;
}

export function GovernanceConfigEditor({ config, label }: GovernanceConfigEditorProps) {
  const { t } = useAppI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [verifyEnabled, setVerifyEnabled] = useState(true);
  const [shadowMode, setShadowMode] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState("15");
  const [maxActions, setMaxActions] = useState("10");
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextConfig = resolveConfig(config);
    setEnabled(nextConfig.WRITEBACK_MAINTENANCE_ENABLED);
    setVerifyEnabled(nextConfig.WRITEBACK_GOVERNANCE_VERIFY_ENABLED);
    setShadowMode(nextConfig.WRITEBACK_GOVERNANCE_SHADOW_MODE);
    setIntervalMinutes(String(Math.max(1, Math.round(nextConfig.WRITEBACK_MAINTENANCE_INTERVAL_MS / 60_000))));
    setMaxActions(String(nextConfig.WRITEBACK_MAINTENANCE_MAX_ACTIONS));
    setErrorMessage(null);
    setSaving(false);
  }, [config, open]);

  async function handleSave() {
    const trimmedIntervalMinutes = intervalMinutes.trim();
    const trimmedMaxActions = maxActions.trim();

    if (!/^\d+$/.test(trimmedIntervalMinutes) || Number(trimmedIntervalMinutes) < 1) {
      setErrorMessage(t("governance.autoConfig.intervalInvalid"));
      return;
    }

    if (
      !/^\d+$/.test(trimmedMaxActions) ||
      Number(trimmedMaxActions) < 1 ||
      Number(trimmedMaxActions) > 20
    ) {
      setErrorMessage(t("governance.autoConfig.maxActionsInvalid"));
      return;
    }

    setErrorMessage(null);
    setSaving(true);
    try {
      const payload = {
        governance: {
          WRITEBACK_MAINTENANCE_ENABLED: enabled,
          WRITEBACK_MAINTENANCE_INTERVAL_MS: Number(trimmedIntervalMinutes) * 60_000,
          WRITEBACK_GOVERNANCE_VERIFY_ENABLED: verifyEnabled,
          WRITEBACK_GOVERNANCE_SHADOW_MODE: shadowMode,
          WRITEBACK_MAINTENANCE_MAX_ACTIONS: Number(trimmedMaxActions)
        }
      };
      const response = await fetch("/api/runtime/config", {
        method: "PUT",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      const responsePayload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(readErrorMessage(responsePayload, t("common.requestFailedStatus", { status: response.status })));
      }

      setOpen(false);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn-outline"
        data-testid="governance-config-editor"
        aria-expanded={open}
        aria-controls="governance-config-inline-form"
        onClick={() => setOpen((value) => !value)}
      >
        {label}
      </button>

      {open ? (
        <div
          id="governance-config-inline-form"
          className="mt-2 basis-full space-y-4 rounded-lg border border-border bg-surface p-4"
          data-testid="governance-config-form"
        >
          <p className="text-[14px] leading-[1.43] text-muted">
            {t("governance.autoConfig.description")}
          </p>
          {errorMessage ? (
            <p className="notice notice-warning" data-testid="governance-config-error">
              {errorMessage}
            </p>
          ) : null}

          <label className="flex items-center gap-3 text-[14px] leading-[1.43] text-text">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            {t("governance.autoConfig.enabled")}
          </label>
          <label className="flex items-center gap-3 text-[14px] leading-[1.43] text-text">
            <input
              type="checkbox"
              checked={verifyEnabled}
              onChange={(event) => setVerifyEnabled(event.target.checked)}
            />
            {t("governance.autoConfig.verifierEnabled")}
          </label>
          <label className="flex items-center gap-3 text-[14px] leading-[1.43] text-text">
            <input
              type="checkbox"
              checked={shadowMode}
              onChange={(event) => setShadowMode(event.target.checked)}
            />
            {t("governance.autoConfig.shadowMode")}
          </label>

          <label className="block">
            <span className="text-xs text-muted-foreground">{t("governance.autoConfig.intervalMinutes")}</span>
            <input
              type="number"
              min={1}
              value={intervalMinutes}
              onChange={(event) => setIntervalMinutes(event.target.value)}
              className="field mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">{t("governance.autoConfig.maxActions")}</span>
            <input
              type="number"
              min={1}
              max={20}
              value={maxActions}
              onChange={(event) => setMaxActions(event.target.value)}
              className="field mt-1"
            />
          </label>

          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" className="btn-outline" onClick={() => setOpen(false)}>
              {t("common.close")}
            </button>
            <button
              type="button"
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
              disabled={saving}
              onClick={() => {
                void handleSave();
              }}
            >
              {saving ? t("governance.autoConfig.saving") : t("governance.autoConfig.save")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
