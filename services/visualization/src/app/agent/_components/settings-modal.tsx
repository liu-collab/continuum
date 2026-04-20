"use client";

import React from "react";
import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Modal } from "@/components/modal";

import type { AgentMemoryMode, MnaAgentConfigResponse } from "../_lib/openapi-types";
import {
  EDITABLE_PROVIDER_KIND_OPTIONS,
  formatProviderKindLabel,
  isEditableProviderKind,
  type EditableProviderKind,
  type ProviderKind
} from "../_lib/provider-kind";
import { useAgentI18n } from "../_i18n/provider";

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
    };
    embedding: {
      base_url?: string;
      model?: string;
      api_key?: string;
    };
    mcp: {
      servers: Array<{
        name: string;
        transport: "stdio" | "http";
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
        headers?: Record<string, string>;
        cwd?: string;
        startup_timeout_ms?: number;
        request_timeout_ms?: number;
        reconnect_on_failure?: boolean;
      }>;
    };
  }): Promise<void>;
};

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
  const [mcpServers, setMcpServers] = useState<MnaAgentConfigResponse["mcp"]["servers"]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    setMcpServers(config.mcp?.servers ?? []);
    setErrorMessage(null);
    setSaving(false);
  }, [config, open]);

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

  async function handleSave() {
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
    setSaving(true);
    try {
      const currentProviderKind: ProviderKind =
        isEditableProviderKind(providerKindToSave) ? providerKind : providerKindToSave;
      await onSaveRuntime({
        provider: {
          kind: currentProviderKind,
          model: trimmedProviderModel,
          ...(trimmedProviderBaseUrl ? { base_url: trimmedProviderBaseUrl } : {}),
          ...(trimmedProviderApiKey ? { api_key: trimmedProviderApiKey } : {})
        },
        embedding: {
          ...(trimmedEmbeddingBaseUrl ? { base_url: trimmedEmbeddingBaseUrl } : {}),
          ...(trimmedEmbeddingModel ? { model: trimmedEmbeddingModel } : {}),
          ...(embeddingApiKey.trim() ? { api_key: embeddingApiKey.trim() } : {})
        },
        mcp: {
          servers: mcpServers.map((server) => ({
            ...server,
            command: server.command?.trim() || undefined,
            url: server.url?.trim() || undefined,
            cwd: server.cwd?.trim() || undefined,
            args: server.args?.filter(Boolean),
          })),
        },
      });
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
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
            onClick={() => {
              void handleSave();
            }}
            data-testid="runtime-config-save"
            disabled={saving}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? t("runtimeConfig.saving") : t("runtimeConfig.save")}
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
          <div className="space-y-3 rounded-lg border bg-surface-muted/20 p-4">
            <div>
              <div className="text-sm font-semibold text-foreground">{t("runtimeConfig.providerTitle")}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("runtimeConfig.providerDescription")}
              </div>
            </div>
            <label className="block">
              <span className="text-xs text-muted-foreground">kind</span>
              <select
                value={isEditableProviderKind(providerKindToSave) ? providerKind : providerKindToSave}
                onChange={(event) => {
                  const nextKind = event.target.value as EditableProviderKind;
                  setProviderKind(nextKind);
                  setProviderKindToSave(nextKind);
                }}
                className="field mt-1"
              >
                {providerKindOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
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
                type="password"
                value={providerApiKey}
                onChange={(event) => setProviderApiKey(event.target.value)}
                placeholder={t("runtimeConfig.providerApiKey")}
                className="field mt-1"
              />
            </label>
          </div>

          <div className="space-y-3 rounded-lg border bg-surface-muted/20 p-4">
            <div>
              <div className="text-sm font-semibold text-foreground">{t("runtimeConfig.embeddingTitle")}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("runtimeConfig.embeddingDescription")}
              </div>
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
                type="password"
                value={embeddingApiKey}
                onChange={(event) => setEmbeddingApiKey(event.target.value)}
                placeholder={t("runtimeConfig.embeddingApiKey")}
                className="field mt-1"
              />
            </label>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border bg-surface-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">{t("runtimeConfig.mcpTitle")}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("runtimeConfig.mcpDescription")}
              </div>
            </div>
            <button
              type="button"
              className="btn-outline"
              onClick={() => {
                setMcpServers((current) => [
                  ...current,
                  {
                    name: "",
                    transport: "http",
                    url: "",
                  },
                ]);
              }}
            >
              {t("runtimeConfig.mcpAdd")}
            </button>
          </div>

          <div className="space-y-4">
            {mcpServers.length === 0 ? (
              <div className="rounded-md border border-dashed bg-surface px-3 py-4 text-xs text-muted-foreground">
                {t("runtimeConfig.mcpEmpty")}
              </div>
            ) : null}

            {mcpServers.map((server, index) => (
              <div key={`${server.name || "mcp"}-${index}`} className="rounded-md border bg-surface p-3">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs text-muted-foreground">{t("runtimeConfig.mcpName")}</span>
                    <input
                      value={server.name}
                      onChange={(event) => {
                        const nextName = event.target.value;
                        setMcpServers((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, name: nextName } : item,
                          ),
                        );
                      }}
                      className="field mt-1"
                    />
                  </label>

                  <label className="block">
                    <span className="text-xs text-muted-foreground">{t("runtimeConfig.mcpTransport")}</span>
                    <select
                      value={server.transport}
                      onChange={(event) => {
                        const nextTransport = event.target.value as "stdio" | "http";
                        setMcpServers((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  transport: nextTransport,
                                  command: nextTransport === "stdio" ? item.command ?? "" : undefined,
                                  url: nextTransport === "http" ? item.url ?? "" : undefined,
                                }
                              : item,
                          ),
                        );
                      }}
                      className="field mt-1"
                    >
                      <option value="http">http</option>
                      <option value="stdio">stdio</option>
                    </select>
                  </label>

                  {server.transport === "http" ? (
                    <label className="block md:col-span-2">
                      <span className="text-xs text-muted-foreground">{t("runtimeConfig.mcpUrl")}</span>
                      <input
                        value={server.url ?? ""}
                        onChange={(event) => {
                          const nextUrl = event.target.value;
                          setMcpServers((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, url: nextUrl } : item,
                            ),
                          );
                        }}
                        className="field mt-1"
                      />
                    </label>
                  ) : (
                    <>
                      <label className="block">
                        <span className="text-xs text-muted-foreground">{t("runtimeConfig.mcpCommand")}</span>
                        <input
                          value={server.command ?? ""}
                          onChange={(event) => {
                            const nextCommand = event.target.value;
                            setMcpServers((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, command: nextCommand } : item,
                              ),
                            );
                          }}
                          className="field mt-1"
                        />
                      </label>
                      <label className="block">
                        <span className="text-xs text-muted-foreground">{t("runtimeConfig.mcpArgs")}</span>
                        <input
                          value={(server.args ?? []).join(" ")}
                          onChange={(event) => {
                            const nextArgs = event.target.value.trim();
                            setMcpServers((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, args: nextArgs ? nextArgs.split(/\s+/) : [] }
                                  : item,
                              ),
                            );
                          }}
                          className="field mt-1"
                        />
                      </label>
                    </>
                  )}
                </div>

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={() => {
                      setMcpServers((current) => current.filter((_, itemIndex) => itemIndex !== index));
                    }}
                  >
                    {t("runtimeConfig.mcpRemove")}
                  </button>
                </div>
              </div>
            ))}
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
