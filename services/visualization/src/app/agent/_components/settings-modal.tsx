"use client";

import React from "react";
import { useEffect, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Modal } from "@/components/modal";

import type { AgentMemoryMode, MnaAgentConfigResponse } from "../_lib/openapi-types";
import { useAgentI18n } from "../_i18n/provider";

type ProviderKind = "demo" | "openai-compatible" | "anthropic" | "ollama" | "record-replay";

type SettingsModalProps = {
  open: boolean;
  onClose(): void;
  config: MnaAgentConfigResponse | null;
  dependencyStatus?: {
    runtime: {
      status?: string;
      embeddings?: {
        status?: string;
        detail?: string;
      };
    };
    provider: {
      status: string;
      detail?: string;
    };
  } | null;
  memoryMode: AgentMemoryMode;
  onMemoryModeChange(value: AgentMemoryMode): void;
  onSaveRuntime(payload: {
    provider: {
      kind: ProviderKind;
      model: string;
      base_url?: string;
      api_key?: string;
      api_key_env?: string;
    };
    embedding: {
      base_url?: string;
      model?: string;
      api_key?: string;
    };
  }): void;
};

const PROVIDER_KIND_OPTIONS: ProviderKind[] = [
  "demo",
  "openai-compatible",
  "anthropic",
  "ollama",
  "record-replay"
];

function resolveStatusTone(status: string | undefined) {
  if (status === "healthy" || status === "configured") return "success" as const;
  if (status === "misconfigured" || status === "unavailable" || status === "not_configured")
    return "warning" as const;
  return "neutral" as const;
}

export function SettingsModal({
  open,
  onClose,
  config,
  dependencyStatus,
  memoryMode,
  onMemoryModeChange,
  onSaveRuntime
}: SettingsModalProps) {
  const { formatMemoryModeLabel, locale, setLocale, t } = useAgentI18n();

  const [providerKind, setProviderKind] = useState<ProviderKind>("demo");
  const [providerModel, setProviderModel] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerApiKeyEnv, setProviderApiKeyEnv] = useState("");
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!config) {
      return;
    }
    setProviderKind(config.provider.kind);
    setProviderModel(config.provider.model ?? "");
    setProviderBaseUrl(config.provider.base_url ?? "");
    setProviderApiKey(config.provider.api_key ?? "");
    setProviderApiKeyEnv(config.provider.api_key_env ?? "");
    setEmbeddingBaseUrl(config.embedding.base_url ?? "");
    setEmbeddingModel(config.embedding.model ?? "");
    setEmbeddingApiKey(config.embedding.api_key ?? "");
    setErrorMessage(null);
  }, [config, open]);

  function handleSave() {
    const trimmedProviderModel = providerModel.trim();
    const trimmedEmbeddingBaseUrl = embeddingBaseUrl.trim();
    const trimmedEmbeddingModel = embeddingModel.trim();

    if (!trimmedProviderModel) {
      setErrorMessage(t("runtimeConfig.errors.providerModelRequired"));
      return;
    }

    if (trimmedEmbeddingBaseUrl && !trimmedEmbeddingModel) {
      setErrorMessage(t("runtimeConfig.errors.embeddingModelRequired"));
      return;
    }

    setErrorMessage(null);
    onSaveRuntime({
      provider: {
        kind: providerKind,
        model: trimmedProviderModel,
        ...(providerBaseUrl.trim() ? { base_url: providerBaseUrl.trim() } : {}),
        ...(providerApiKey.trim() ? { api_key: providerApiKey.trim() } : {}),
        ...(providerApiKeyEnv.trim() ? { api_key_env: providerApiKeyEnv.trim() } : {})
      },
      embedding: {
        ...(trimmedEmbeddingBaseUrl ? { base_url: trimmedEmbeddingBaseUrl } : {}),
        ...(trimmedEmbeddingModel ? { model: trimmedEmbeddingModel } : {}),
        ...(embeddingApiKey.trim() ? { api_key: embeddingApiKey.trim() } : {})
      }
    });
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("runtimeConfig.title")}
      description={t("runtimeConfig.description")}
      size="xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-outline">
            {t("promptInspector.close")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            data-testid="runtime-config-save"
            className="btn-primary"
          >
            {t("runtimeConfig.save")}
          </button>
        </>
      }
    >
      <div className="space-y-6" data-testid="runtime-config-card">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border bg-surface-muted/40 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerStatus")}</span>
              <StatusBadge tone={resolveStatusTone(dependencyStatus?.provider.status)}>
                {dependencyStatus?.provider.status ?? "unknown"}
              </StatusBadge>
            </div>
            {dependencyStatus?.provider.detail ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{dependencyStatus.provider.detail}</p>
            ) : null}
          </div>
          <div className="rounded-md border bg-surface-muted/40 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.embeddingStatus")}</span>
              <StatusBadge tone={resolveStatusTone(dependencyStatus?.runtime.embeddings?.status)}>
                {dependencyStatus?.runtime.embeddings?.status ?? "unknown"}
              </StatusBadge>
            </div>
            {dependencyStatus?.runtime.embeddings?.detail ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {dependencyStatus.runtime.embeddings.detail}
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">{t("modeSwitch.label")}</span>
            <select
              data-testid="memory-mode-select"
              value={memoryMode}
              onChange={(event) => onMemoryModeChange(event.target.value as AgentMemoryMode)}
              className="field mt-1"
            >
              <option value="workspace_plus_global">{formatMemoryModeLabel("workspace_plus_global")}</option>
              <option value="workspace_only">{formatMemoryModeLabel("workspace_only")}</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">{t("localeSwitch.label")}</span>
            <select
              data-testid="agent-locale-select"
              value={locale}
              onChange={(event) => setLocale(event.target.value as "zh-CN" | "en-US")}
              className="field mt-1"
            >
              <option value="zh-CN">{t("localeSwitch.options.zh-CN")}</option>
              <option value="en-US">{t("localeSwitch.options.en-US")}</option>
            </select>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t("runtimeConfig.providerTitle")}
            </div>
            <label className="block">
              <span className="text-xs text-muted-foreground">kind</span>
              <select
                value={providerKind}
                onChange={(event) => setProviderKind(event.target.value as ProviderKind)}
                className="field mt-1"
              >
                {PROVIDER_KIND_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerModel")}</span>
              <input
                value={providerModel}
                onChange={(event) => setProviderModel(event.target.value)}
                placeholder={t("runtimeConfig.providerModel")}
                className="field mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerBaseUrl")}</span>
              <input
                value={providerBaseUrl}
                onChange={(event) => setProviderBaseUrl(event.target.value)}
                placeholder={t("runtimeConfig.providerBaseUrl")}
                className="field mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerApiKey")}</span>
              <input
                value={providerApiKey}
                onChange={(event) => setProviderApiKey(event.target.value)}
                placeholder={t("runtimeConfig.providerApiKey")}
                className="field mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerApiKeyEnv")}</span>
              <input
                value={providerApiKeyEnv}
                onChange={(event) => setProviderApiKeyEnv(event.target.value)}
                placeholder={t("runtimeConfig.providerApiKeyEnv")}
                className="field mt-1"
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {t("runtimeConfig.embeddingTitle")}
            </div>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.embeddingBaseUrl")}</span>
              <input
                value={embeddingBaseUrl}
                onChange={(event) => setEmbeddingBaseUrl(event.target.value)}
                placeholder={t("runtimeConfig.embeddingBaseUrl")}
                className="field mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.embeddingModel")}</span>
              <input
                value={embeddingModel}
                onChange={(event) => setEmbeddingModel(event.target.value)}
                placeholder={t("runtimeConfig.embeddingModel")}
                className="field mt-1"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.embeddingApiKey")}</span>
              <input
                value={embeddingApiKey}
                onChange={(event) => setEmbeddingApiKey(event.target.value)}
                placeholder={t("runtimeConfig.embeddingApiKey")}
                className="field mt-1"
              />
            </label>
          </div>
        </div>

        {errorMessage ? (
          <p className="text-sm text-rose-600" data-testid="runtime-config-error">
            {errorMessage}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
