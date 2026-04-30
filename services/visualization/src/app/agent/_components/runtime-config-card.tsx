"use client";

import React from "react";
import { useEffect, useMemo, useState } from "react";
import { Info } from "lucide-react";

import { SelectField } from "@/components/select-field";

import type { MnaAgentConfigResponse } from "../_lib/openapi-types";
import {
  EDITABLE_PROVIDER_KIND_OPTIONS,
  formatProviderKindLabel,
  isEditableProviderKind,
  type EditableProviderKind,
  type ProviderKind
} from "../_lib/provider-kind";
import { useAgentI18n } from "@/lib/i18n/agent/provider";

type RuntimeConfigCardProps = {
  config: MnaAgentConfigResponse | null;
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

export function RuntimeConfigCard({ config, onSave }: RuntimeConfigCardProps) {
  const { t } = useAgentI18n();
  const [providerKind, setProviderKind] = useState<EditableProviderKind>(
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

    if (config.provider.kind === "not-configured") {
      setProviderKind("openai-compatible");
      setProviderKindToSave("openai-compatible");
    } else if (isEditableProviderKind(config.provider.kind)) {
      setProviderKind(config.provider.kind);
      setProviderKindToSave(config.provider.kind);
    } else {
      setProviderKindToSave(config.provider.kind);
    }
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
      return currentProviderKind === "openai-compatible" || currentProviderKind === "openai-responses" || currentProviderKind === "anthropic" || currentProviderKind === "ollama";
    },
    [providerKind, providerKindToSave]
  );

  const providerRequiresApiKey = useMemo(
    () => {
      const currentProviderKind = isEditableProviderKind(providerKindToSave) ? providerKind : providerKindToSave;
      return currentProviderKind === "openai-compatible" || currentProviderKind === "openai-responses" || currentProviderKind === "anthropic";
    },
    [providerKind, providerKindToSave]
  );

  function handleSave() {
    const trimmedProviderModel = providerModel.trim();
    const trimmedProviderBaseUrl = providerBaseUrl.trim();
    const trimmedProviderApiKey = providerApiKey.trim();
    const trimmedEmbeddingBaseUrl = embeddingBaseUrl.trim();
    const trimmedEmbeddingModel = embeddingModel.trim();
    const trimmedEmbeddingApiKey = embeddingApiKey.trim();

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

    if (!trimmedEmbeddingApiKey) {
      setErrorMessage(t("runtimeConfig.errors.embeddingApiKeyRequired"));
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
        api_key: trimmedEmbeddingApiKey,
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
        <h2 className="headline-display mt-2 text-[21px] font-semibold leading-[1.19] text-text">{t("runtimeConfig.title")}</h2>
      </div>

      <div className="mt-5 grid gap-4">
        <div className="grid gap-3">
          <div className="flex items-center gap-2">
            <div className="text-[14px] font-semibold leading-[1.29] text-text">{t("runtimeConfig.embeddingTitle")}</div>
            <EmbeddingHint text={t("runtimeConfig.embeddingHint")} />
          </div>
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
              const nextKind = value as EditableProviderKind;
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

function EmbeddingHint({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-label={text}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        data-testid="embedding-config-hint"
      >
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-72 -translate-x-1/2 rounded-md border bg-surface px-3 py-2 text-xs leading-5 text-foreground shadow-overlay group-focus-within:block group-hover:block">
        {text}
      </span>
    </span>
  );
}
