"use client";

import React from "react";
import { useEffect, useState } from "react";

import { StatusBadge } from "@/components/status-badge";

import type { MnaAgentConfigResponse } from "../_lib/openapi-types";
import { useAgentI18n } from "../_i18n/provider";

type ProviderKind = "demo" | "openai-compatible" | "anthropic" | "ollama" | "record-replay";

type RuntimeConfigCardProps = {
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
  onSave(payload: {
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
  "record-replay",
];

function resolveStatusTone(status: string | undefined) {
  if (status === "healthy" || status === "configured") {
    return "success" as const;
  }
  if (status === "misconfigured" || status === "unavailable" || status === "not_configured") {
    return "warning" as const;
  }
  return "neutral" as const;
}

export function RuntimeConfigCard({ config, dependencyStatus, onSave }: RuntimeConfigCardProps) {
  const { t } = useAgentI18n();
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
  }, [config]);

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
    onSave({
      provider: {
        kind: providerKind,
        model: trimmedProviderModel,
        ...(providerBaseUrl.trim() ? { base_url: providerBaseUrl.trim() } : {}),
        ...(providerApiKey.trim() ? { api_key: providerApiKey.trim() } : {}),
        ...(providerApiKeyEnv.trim() ? { api_key_env: providerApiKeyEnv.trim() } : {}),
      },
      embedding: {
        ...(trimmedEmbeddingBaseUrl ? { base_url: trimmedEmbeddingBaseUrl } : {}),
        ...(trimmedEmbeddingModel ? { model: trimmedEmbeddingModel } : {}),
        ...(embeddingApiKey.trim() ? { api_key: embeddingApiKey.trim() } : {}),
      },
    });
  }

  return (
    <section className="rounded-3xl border bg-white/88 p-5 shadow-soft" data-testid="runtime-config-card">
      <div>
        <p className="eyebrow">{t("runtimeConfig.eyebrow")}</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">{t("runtimeConfig.title")}</h2>
        <p className="mt-2 text-sm text-slate-500">{t("runtimeConfig.description")}</p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">{t("runtimeConfig.providerStatus")}</span>
            <StatusBadge tone={resolveStatusTone(dependencyStatus?.provider.status)}>
              {dependencyStatus?.provider.status ?? "unknown"}
            </StatusBadge>
          </div>
          {dependencyStatus?.provider.detail ? (
            <p className="mt-2 text-xs leading-5 text-slate-500">{dependencyStatus.provider.detail}</p>
          ) : null}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-slate-500">{t("runtimeConfig.embeddingStatus")}</span>
            <StatusBadge tone={resolveStatusTone(dependencyStatus?.runtime.embeddings?.status)}>
              {dependencyStatus?.runtime.embeddings?.status ?? "unknown"}
            </StatusBadge>
          </div>
          {dependencyStatus?.runtime.embeddings?.detail ? (
            <p className="mt-2 text-xs leading-5 text-slate-500">{dependencyStatus.runtime.embeddings.detail}</p>
          ) : null}
        </div>
      </div>

      <div className="mt-5 grid gap-6 xl:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="text-sm font-semibold text-slate-900">{t("runtimeConfig.embeddingTitle")}</div>
          <input
            value={embeddingBaseUrl}
            onChange={(event) => setEmbeddingBaseUrl(event.target.value)}
            placeholder={t("runtimeConfig.embeddingBaseUrl")}
            className="w-full rounded-2xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
          <input
            value={embeddingModel}
            onChange={(event) => setEmbeddingModel(event.target.value)}
            placeholder={t("runtimeConfig.embeddingModel")}
            className="w-full rounded-2xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
          <input
            value={embeddingApiKey}
            onChange={(event) => setEmbeddingApiKey(event.target.value)}
            placeholder={t("runtimeConfig.embeddingApiKey")}
            className="w-full rounded-2xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
        </div>

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <div className="text-sm font-semibold text-slate-900">{t("runtimeConfig.providerTitle")}</div>
          <select
            value={providerKind}
            onChange={(event) => setProviderKind(event.target.value as ProviderKind)}
            className="w-full rounded-2xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          >
            {PROVIDER_KIND_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            value={providerModel}
            onChange={(event) => setProviderModel(event.target.value)}
            placeholder={t("runtimeConfig.providerModel")}
            className="w-full rounded-2xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
          <input
            value={providerBaseUrl}
            onChange={(event) => setProviderBaseUrl(event.target.value)}
            placeholder={t("runtimeConfig.providerBaseUrl")}
            className="w-full rounded-2xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
          <input
            value={providerApiKey}
            onChange={(event) => setProviderApiKey(event.target.value)}
            placeholder={t("runtimeConfig.providerApiKey")}
            className="w-full rounded-2xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
          <input
            value={providerApiKeyEnv}
            onChange={(event) => setProviderApiKeyEnv(event.target.value)}
            placeholder={t("runtimeConfig.providerApiKeyEnv")}
            className="w-full rounded-2xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          />
        </div>
      </div>

      {errorMessage ? (
        <p className="mt-4 text-sm text-rose-600" data-testid="runtime-config-error">
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95"
        >
          {t("runtimeConfig.save")}
        </button>
      </div>
    </section>
  );
}
