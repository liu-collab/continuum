"use client";

import React from "react";
import { useEffect, useMemo, useState } from "react";

import { SelectField } from "@/components/select-field";
import { StatusBadge } from "@/components/status-badge";

import type { MnaAgentConfigResponse } from "../_lib/openapi-types";
import {
  EDITABLE_PROVIDER_KIND_OPTIONS,
  formatProviderKindLabel,
  isEditableProviderKind,
  type ProviderKind
} from "../_lib/provider-kind";
import { useAgentI18n } from "@/lib/i18n/agent/provider";

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
    <section className="panel p-5" data-testid="runtime-config-summary-card">
      <div>
        <p className="section-kicker">{t("runtimeConfig.eyebrow")}</p>
        <h2 className="mt-2 text-[21px] font-semibold leading-[1.19] text-text">{t("runtimeConfig.title")}</h2>
      </div>

      <div className="mt-4 grid gap-3">
        <StatusBlock label={t("runtimeConfig.providerStatus")} status={dependencyStatus?.provider.status ?? "unknown"} detail={dependencyStatus?.provider.detail} />
        <StatusBlock label={t("runtimeConfig.embeddingStatus")} status={dependencyStatus?.runtime.embeddings?.status ?? "unknown"} detail={dependencyStatus?.runtime.embeddings?.detail} />
      </div>

      <div className="mt-5 grid gap-4">
        <div className="grid gap-3">
          <div className="text-[14px] font-semibold leading-[1.29] text-text">{t("runtimeConfig.embeddingTitle")}</div>
          <input
            value={embeddingBaseUrl}
            onChange={(event) => setEmbeddingBaseUrl(event.target.value)}
            placeholder={t("runtimeConfig.embeddingBaseUrl")}
            className="field"
          />
          <input
            value={embeddingModel}
            onChange={(event) => setEmbeddingModel(event.target.value)}
            placeholder={t("runtimeConfig.embeddingModel")}
            className="field"
          />
          <input
            value={embeddingApiKey}
            onChange={(event) => setEmbeddingApiKey(event.target.value)}
            placeholder={t("runtimeConfig.embeddingApiKey")}
            className="field"
          />
        </div>

        <div className="grid gap-3">
          <div className="text-[14px] font-semibold leading-[1.29] text-text">{t("runtimeConfig.providerTitle")}</div>
          <SelectField
            value={isEditableProviderKind(providerKindToSave) ? providerKind : providerKindToSave}
            onChange={(value) => {
              const nextKind = value as "openai-compatible" | "anthropic" | "ollama";
              setProviderKind(nextKind);
              setProviderKindToSave(nextKind);
            }}
            options={providerKindOptions}
          />
          <input
            value={providerModel}
            onChange={(event) => setProviderModel(event.target.value)}
            placeholder={t("runtimeConfig.providerModel")}
            className="field"
          />
          <input
            value={providerBaseUrl}
            onChange={(event) => setProviderBaseUrl(event.target.value)}
            placeholder={t("runtimeConfig.providerBaseUrl")}
            className="field"
          />
          <input
            value={providerApiKey}
            onChange={(event) => setProviderApiKey(event.target.value)}
            placeholder={t("runtimeConfig.providerApiKey")}
            className="field"
          />
        </div>
      </div>

      {errorMessage ? (
        <p className="notice notice-danger mt-4" data-testid="runtime-config-error">
          {errorMessage}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button type="button" onClick={handleSave} className="button-primary">
          {t("runtimeConfig.save")}
        </button>
      </div>
    </section>
  );
}

function StatusBlock({ label, status, detail }: { label: string; status: string; detail?: string }) {
  return (
    <div className="record-card">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[14px] leading-[1.43] text-muted">{label}</span>
        <StatusBadge tone={resolveStatusTone(status)}>{status}</StatusBadge>
      </div>
      {detail ? <p className="mt-2 text-[14px] leading-[1.43] text-muted">{detail}</p> : null}
    </div>
  );
}
