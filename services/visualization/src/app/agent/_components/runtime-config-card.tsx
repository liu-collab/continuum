"use client";

import React from "react";
import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";

import type { MnaAgentConfigResponse } from "../_lib/openapi-types";
import {
  EDITABLE_PROVIDER_KIND_OPTIONS,
  formatProviderKindLabel,
  isEditableProviderKind,
  type EditableProviderKind,
  type ProviderKind
} from "../_lib/provider-kind";
import { useAgentI18n } from "../_i18n/provider";

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
    };
    embedding: {
      base_url?: string;
      model?: string;
      api_key?: string;
    };
  }): void;
};

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
  const [providerKind, setProviderKind] = useState<"openai-compatible" | "anthropic" | "ollama">(
    "openai-compatible"
  );
  const [providerKindToSave, setProviderKindToSave] = useState<ProviderKind>("openai-compatible");
  const [providerModel, setProviderModel] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!config) {
      return;
    }

    if (isEditableProviderKind(config.provider.kind)) {
      setProviderKind(config.provider.kind);
    }
    setProviderKindToSave(config.provider.kind);
    setProviderModel(config.provider.model ?? "");
    setProviderBaseUrl(config.provider.base_url ?? "");
    setProviderApiKey(config.provider.api_key ?? "");
    setEmbeddingBaseUrl(config.embedding.base_url ?? "");
    setEmbeddingModel(config.embedding.model ?? "");
    setEmbeddingApiKey(config.embedding.api_key ?? "");
    setErrorMessage(null);
  }, [config]);

  const providerRequiresBaseUrl = useMemo(
    () => {
      const currentProviderKind = isEditableProviderKind(providerKindToSave) ? providerKind : providerKindToSave;
      return currentProviderKind === "openai-compatible" || currentProviderKind === "anthropic" || currentProviderKind === "ollama";
    },
    [providerKind, providerKindToSave]
  );

  const providerRequiresApiKey = useMemo(
    () => {
      const currentProviderKind = isEditableProviderKind(providerKindToSave) ? providerKind : providerKindToSave;
      return currentProviderKind === "openai-compatible" || currentProviderKind === "anthropic";
    },
    [providerKind, providerKindToSave]
  );

  function handleSave() {
    const trimmedProviderModel = providerModel.trim();
    const trimmedProviderBaseUrl = providerBaseUrl.trim();
    const trimmedProviderApiKey = providerApiKey.trim();
    const trimmedEmbeddingBaseUrl = embeddingBaseUrl.trim();
    const trimmedEmbeddingModel = embeddingModel.trim();

    if (!trimmedProviderModel) {
      setErrorMessage(t("runtimeConfig.errors.providerModelRequired"));
      return;
    }

    if (providerRequiresBaseUrl && !trimmedProviderBaseUrl) {
      setErrorMessage(t("runtimeConfig.errors.providerBaseUrlRequired"));
      return;
    }

    if (providerRequiresApiKey && !trimmedProviderApiKey) {
      setErrorMessage(t("runtimeConfig.errors.providerApiKeyRequired"));
      return;
    }

    if (trimmedEmbeddingBaseUrl && !trimmedEmbeddingModel) {
      setErrorMessage(t("runtimeConfig.errors.embeddingModelRequired"));
      return;
    }

    setErrorMessage(null);
    const currentProviderKind: ProviderKind =
      isEditableProviderKind(providerKindToSave) ? providerKind : providerKindToSave;
    onSave({
      provider: {
        kind: currentProviderKind,
        model: trimmedProviderModel,
        ...(trimmedProviderBaseUrl ? { base_url: trimmedProviderBaseUrl } : {}),
        ...(trimmedProviderApiKey ? { api_key: trimmedProviderApiKey } : {}),
      },
      embedding: {
        ...(trimmedEmbeddingBaseUrl ? { base_url: trimmedEmbeddingBaseUrl } : {}),
        ...(trimmedEmbeddingModel ? { model: trimmedEmbeddingModel } : {}),
        ...(embeddingApiKey.trim() ? { api_key: embeddingApiKey.trim() } : {}),
      },
    });
  }

  const providerKindOptions = isEditableProviderKind(providerKindToSave)
    ? EDITABLE_PROVIDER_KIND_OPTIONS
    : [
        ...EDITABLE_PROVIDER_KIND_OPTIONS,
        {
          value: providerKindToSave,
          label: formatProviderKindLabel(providerKindToSave)
        }
      ];

  return (
    <section className="rounded-3xl border bg-white/88 p-5 shadow-soft" data-testid="runtime-config-card">
      <div>
        <p className="eyebrow">{t("runtimeConfig.eyebrow")}</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">{t("runtimeConfig.title")}</h2>
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
            value={isEditableProviderKind(providerKindToSave) ? providerKind : providerKindToSave}
            onChange={(event) => {
              const nextKind = event.target.value as "openai-compatible" | "anthropic" | "ollama";
              setProviderKind(nextKind);
              setProviderKindToSave(nextKind);
            }}
            className="w-full rounded-2xl border bg-white px-3 py-2 text-sm text-slate-700 outline-none"
          >
            {providerKindOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
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
