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
      memory_llm?: {
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
      effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
      max_tokens?: number;
    };
    embedding: {
      base_url?: string;
      model?: string;
      api_key?: string;
    };
    tools: {
      approval_mode: "confirm" | "yolo";
    };
    planning: {
      plan_mode: "advisory" | "confirm";
    };
    memory_llm: {
      base_url?: string;
      model?: string;
      api_key?: string;
      protocol?: "anthropic" | "openai-compatible";
      timeout_ms?: number;
      effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
      max_tokens?: number;
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
  onCheckEmbeddings(): Promise<{
    status: string;
    detail: string;
  }>;
  onCheckMemoryLlm(): Promise<{
    status: string;
    detail: string;
  }>;
};

function resolveStatusTone(status: string | undefined) {
  if (status === "healthy" || status === "configured") return "success" as const;
  if (status === "misconfigured" || status === "unavailable" || status === "not_configured")
    return "warning" as const;
  return "neutral" as const;
}

type MemoryModelMode = "same_as_primary" | "custom";

function resolveMemoryProtocolFromProviderKind(
  kind: ProviderKind,
): "anthropic" | "openai-compatible" | null {
  if (kind === "anthropic") {
    return "anthropic";
  }
  if (kind === "openai-compatible") {
    return "openai-compatible";
  }
  return null;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizeOptionalNumber(value: number | null | undefined) {
  return value ? String(value) : "";
}

export function SettingsModal({
  open,
  onClose,
  config,
  dependencyStatus,
  memoryMode,
  onMemoryModeChange,
  onSaveRuntime,
  onCheckEmbeddings,
  onCheckMemoryLlm
}: SettingsModalProps) {
  const { formatMemoryModeLabel, locale, setLocale, t } = useAgentI18n();

  const [providerKind, setProviderKind] = useState<"openai-compatible" | "anthropic" | "ollama">(
    "openai-compatible"
  );
  const [providerKindToSave, setProviderKindToSave] = useState<ProviderKind>("openai-compatible");
  const [providerModel, setProviderModel] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerEffort, setProviderEffort] = useState<"low" | "medium" | "high" | "xhigh" | "max" | "">("");
  const [providerMaxTokens, setProviderMaxTokens] = useState("");
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState("");
  const [embeddingModel, setEmbeddingModel] = useState("");
  const [embeddingApiKey, setEmbeddingApiKey] = useState("");
  const [approvalMode, setApprovalMode] = useState<"confirm" | "yolo">("confirm");
  const [planMode, setPlanMode] = useState<"advisory" | "confirm">("advisory");
  const [memoryLlmBaseUrl, setMemoryLlmBaseUrl] = useState("");
  const [memoryLlmModel, setMemoryLlmModel] = useState("");
  const [memoryLlmApiKey, setMemoryLlmApiKey] = useState("");
  const [memoryLlmProtocol, setMemoryLlmProtocol] = useState<"anthropic" | "openai-compatible">("openai-compatible");
  const [memoryLlmTimeoutMs, setMemoryLlmTimeoutMs] = useState("");
  const [memoryLlmEffort, setMemoryLlmEffort] = useState<"low" | "medium" | "high" | "xhigh" | "max" | "">("");
  const [memoryLlmMaxTokens, setMemoryLlmMaxTokens] = useState("");
  const [memoryModelMode, setMemoryModelMode] = useState<MemoryModelMode>("custom");
  const [mcpServers, setMcpServers] = useState<MnaAgentConfigResponse["mcp"]["servers"]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [checkingEmbeddings, setCheckingEmbeddings] = useState(false);
  const [checkingMemoryLlm, setCheckingMemoryLlm] = useState(false);

  const currentProviderKind: ProviderKind = useMemo(
    () => (isEditableProviderKind(providerKindToSave) ? providerKind : providerKindToSave),
    [providerKind, providerKindToSave],
  );

  const primaryMemoryProtocol = useMemo(
    () => resolveMemoryProtocolFromProviderKind(currentProviderKind),
    [currentProviderKind],
  );

  const canMirrorPrimaryModel = primaryMemoryProtocol !== null;

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
    setProviderEffort(config.provider.effort ?? "");
    setProviderMaxTokens(config.provider.max_tokens ? String(config.provider.max_tokens) : "");
    setApprovalMode(config.tools.approval_mode ?? "confirm");
    setPlanMode(config.planning?.plan_mode ?? "advisory");
    setEmbeddingBaseUrl(config.embedding.base_url ?? "");
    setEmbeddingModel(config.embedding.model ?? "");
    setEmbeddingApiKey(config.embedding.api_key ?? "");
    setMemoryLlmBaseUrl(config.memory_llm.base_url ?? "");
    setMemoryLlmModel(config.memory_llm.model ?? "");
    setMemoryLlmApiKey(config.memory_llm.api_key ?? "");
    setMemoryLlmProtocol(config.memory_llm.protocol ?? "openai-compatible");
    setMemoryLlmTimeoutMs(config.memory_llm.timeout_ms ? String(config.memory_llm.timeout_ms) : "");
    setMemoryLlmEffort(config.memory_llm.effort ?? "");
    setMemoryLlmMaxTokens(config.memory_llm.max_tokens ? String(config.memory_llm.max_tokens) : "");
    const mirroredProtocol = resolveMemoryProtocolFromProviderKind(config.provider.kind);
    const matchesPrimaryModel = Boolean(
      mirroredProtocol
      && normalizeText(config.memory_llm.base_url) === normalizeText(config.provider.base_url)
      && normalizeText(config.memory_llm.model) === normalizeText(config.provider.model)
      && normalizeText(config.memory_llm.api_key) === normalizeText(config.provider.api_key)
      && (config.memory_llm.protocol ?? "openai-compatible") === mirroredProtocol
      && (config.memory_llm.effort ?? "") === (config.provider.effort ?? "")
      && normalizeOptionalNumber(config.memory_llm.max_tokens) === normalizeOptionalNumber(config.provider.max_tokens),
    );
    setMemoryModelMode(matchesPrimaryModel ? "same_as_primary" : "custom");
    setMcpServers(config.mcp?.servers ?? []);
    setErrorMessage(null);
    setFeedbackMessage(null);
    setSaving(false);
    setCheckingEmbeddings(false);
    setCheckingMemoryLlm(false);
  }, [config, open]);

  useEffect(() => {
    if (!canMirrorPrimaryModel && memoryModelMode === "same_as_primary") {
      setMemoryModelMode("custom");
    }
  }, [canMirrorPrimaryModel, memoryModelMode]);

  const providerRequiresBaseUrl = useMemo(
    () => currentProviderKind === "openai-compatible" || currentProviderKind === "anthropic" || currentProviderKind === "ollama",
    [currentProviderKind],
  );

  const providerRequiresApiKey = useMemo(
    () => currentProviderKind === "openai-compatible" || currentProviderKind === "anthropic",
    [currentProviderKind],
  );

  const effectiveMemoryConfig = useMemo(() => {
    if (memoryModelMode === "same_as_primary" && primaryMemoryProtocol) {
      return {
        baseUrl: providerBaseUrl.trim(),
        model: providerModel.trim(),
        apiKey: providerApiKey.trim(),
        protocol: primaryMemoryProtocol,
        timeoutMs: memoryLlmTimeoutMs.trim(),
        effort: providerEffort,
        maxTokens: providerMaxTokens.trim(),
      };
    }

    return {
      baseUrl: memoryLlmBaseUrl.trim(),
      model: memoryLlmModel.trim(),
      apiKey: memoryLlmApiKey.trim(),
      protocol: memoryLlmProtocol,
      timeoutMs: memoryLlmTimeoutMs.trim(),
      effort: memoryLlmEffort,
      maxTokens: memoryLlmMaxTokens.trim(),
    };
  }, [
    memoryLlmApiKey,
    memoryLlmBaseUrl,
    memoryLlmEffort,
    memoryLlmMaxTokens,
    memoryLlmModel,
    memoryLlmProtocol,
    memoryLlmTimeoutMs,
    memoryModelMode,
    primaryMemoryProtocol,
    providerApiKey,
    providerBaseUrl,
    providerEffort,
    providerMaxTokens,
    providerModel,
  ]);

  async function handleSave() {
    const trimmedProviderModel = providerModel.trim();
    const trimmedProviderBaseUrl = providerBaseUrl.trim();
    const trimmedProviderApiKey = providerApiKey.trim();
    const trimmedProviderMaxTokens = providerMaxTokens.trim();
    const trimmedEmbeddingBaseUrl = embeddingBaseUrl.trim();
    const trimmedEmbeddingModel = embeddingModel.trim();
    const trimmedMemoryLlmBaseUrl = memoryLlmBaseUrl.trim();
    const trimmedMemoryLlmModel = memoryLlmModel.trim();
    const trimmedMemoryLlmApiKey = memoryLlmApiKey.trim();
    const trimmedMemoryLlmTimeoutMs = memoryLlmTimeoutMs.trim();
    const trimmedMemoryLlmMaxTokens = memoryLlmMaxTokens.trim();

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

    if (memoryModelMode === "same_as_primary" && !primaryMemoryProtocol) {
      setErrorMessage(t("runtimeConfig.errors.memoryLlmFollowUnsupported"));
      return;
    }

    if (effectiveMemoryConfig.baseUrl && !effectiveMemoryConfig.model) {
      setErrorMessage(t("runtimeConfig.errors.memoryLlmModelRequired"));
      return;
    }

    if (effectiveMemoryConfig.timeoutMs && !/^\d+$/.test(effectiveMemoryConfig.timeoutMs)) {
      setErrorMessage(t("runtimeConfig.errors.memoryLlmTimeoutInvalid"));
      return;
    }

    if (trimmedProviderMaxTokens && !/^\d+$/.test(trimmedProviderMaxTokens)) {
      setErrorMessage(t("runtimeConfig.errors.providerMaxTokensInvalid"));
      return;
    }

    if (effectiveMemoryConfig.maxTokens && !/^\d+$/.test(effectiveMemoryConfig.maxTokens)) {
      setErrorMessage(t("runtimeConfig.errors.memoryLlmMaxTokensInvalid"));
      return;
    }

    setErrorMessage(null);
    setFeedbackMessage(null);
    setSaving(true);
    try {
      await onSaveRuntime({
        provider: {
          kind: currentProviderKind,
          model: trimmedProviderModel,
          ...(trimmedProviderBaseUrl ? { base_url: trimmedProviderBaseUrl } : {}),
          ...(trimmedProviderApiKey ? { api_key: trimmedProviderApiKey } : {}),
          effort: providerEffort || null,
          ...(trimmedProviderMaxTokens ? { max_tokens: Number(trimmedProviderMaxTokens) } : {})
        },
        embedding: {
          ...(trimmedEmbeddingBaseUrl ? { base_url: trimmedEmbeddingBaseUrl } : {}),
          ...(trimmedEmbeddingModel ? { model: trimmedEmbeddingModel } : {}),
          ...(embeddingApiKey.trim() ? { api_key: embeddingApiKey.trim() } : {})
        },
        tools: {
          approval_mode: approvalMode,
        },
        planning: {
          plan_mode: planMode,
        },
        memory_llm: {
          ...(effectiveMemoryConfig.baseUrl ? { base_url: effectiveMemoryConfig.baseUrl } : {}),
          ...(effectiveMemoryConfig.model ? { model: effectiveMemoryConfig.model } : {}),
          ...(effectiveMemoryConfig.apiKey ? { api_key: effectiveMemoryConfig.apiKey } : {}),
          protocol: effectiveMemoryConfig.protocol,
          ...(effectiveMemoryConfig.timeoutMs ? { timeout_ms: Number(effectiveMemoryConfig.timeoutMs) } : {}),
          effort: effectiveMemoryConfig.effort || null,
          ...(effectiveMemoryConfig.maxTokens ? { max_tokens: Number(effectiveMemoryConfig.maxTokens) } : {}),
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

  async function handleCheckEmbeddings() {
    setErrorMessage(null);
    setFeedbackMessage(null);
    const currentBaseUrl = config?.embedding.base_url?.trim() ?? "";
    const currentModel = config?.embedding.model?.trim() ?? "";
    const currentApiKey = config?.embedding.api_key?.trim() ?? "";
    if (
      embeddingBaseUrl.trim() !== currentBaseUrl ||
      embeddingModel.trim() !== currentModel ||
      embeddingApiKey.trim() !== currentApiKey
    ) {
      setFeedbackMessage({
        tone: "warning",
        text: t("runtimeConfig.saveEmbeddingBeforeCheck"),
      });
      return;
    }
    setCheckingEmbeddings(true);
    try {
      const result = await onCheckEmbeddings();
      setFeedbackMessage({
        tone: result.status === "healthy" ? "success" : "warning",
        text: `${result.status}: ${result.detail}`,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingEmbeddings(false);
    }
  }

  async function handleCheckMemoryLlm() {
    setErrorMessage(null);
    setFeedbackMessage(null);
    const currentBaseUrl = config?.memory_llm.base_url?.trim() ?? "";
    const currentModel = config?.memory_llm.model?.trim() ?? "";
    const currentApiKey = config?.memory_llm.api_key?.trim() ?? "";
    const currentProtocol = config?.memory_llm.protocol ?? "openai-compatible";
    const currentTimeout = config?.memory_llm.timeout_ms ? String(config.memory_llm.timeout_ms) : "";
    const currentEffort = config?.memory_llm.effort ?? "";
    const currentMaxTokens = config?.memory_llm.max_tokens ? String(config.memory_llm.max_tokens) : "";
    if (
      effectiveMemoryConfig.baseUrl !== currentBaseUrl ||
      effectiveMemoryConfig.model !== currentModel ||
      effectiveMemoryConfig.apiKey !== currentApiKey ||
      effectiveMemoryConfig.protocol !== currentProtocol ||
      effectiveMemoryConfig.timeoutMs !== currentTimeout ||
      effectiveMemoryConfig.effort !== currentEffort ||
      effectiveMemoryConfig.maxTokens !== currentMaxTokens
    ) {
      setFeedbackMessage({
        tone: "warning",
        text: t("runtimeConfig.saveMemoryLlmBeforeCheck"),
      });
      return;
    }
    setCheckingMemoryLlm(true);
    try {
      const result = await onCheckMemoryLlm();
      setFeedbackMessage({
        tone: result.status === "healthy" ? "success" : "warning",
        text: `${result.status}: ${result.detail}`,
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingMemoryLlm(false);
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
            <div className="mt-2">
              <button
                type="button"
                onClick={() => {
                  void handleCheckEmbeddings();
                }}
                disabled={checkingEmbeddings}
                className="btn-outline"
                data-testid="runtime-config-check-embeddings"
              >
                {checkingEmbeddings ? t("runtimeConfig.checkingEmbedding") : t("runtimeConfig.checkEmbedding")}
              </button>
            </div>
          </div>
          <div className="rounded-md border bg-surface-muted/40 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.memoryLlmStatus")}</span>
              <StatusBadge tone={resolveStatusTone(dependencyStatus?.runtime.memory_llm?.status)}>
                {dependencyStatus?.runtime.memory_llm?.status ?? "unknown"}
              </StatusBadge>
            </div>
            {dependencyStatus?.runtime.memory_llm?.detail ? (
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {dependencyStatus.runtime.memory_llm.detail}
              </p>
            ) : null}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => {
                  void handleCheckMemoryLlm();
                }}
                disabled={checkingMemoryLlm}
                className="btn-outline"
                data-testid="runtime-config-check-memory-llm"
              >
                {checkingMemoryLlm ? t("runtimeConfig.checkingMemoryLlm") : t("runtimeConfig.checkMemoryLlm")}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
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
          <div className="block">
            <span className="text-xs font-medium text-muted-foreground">{t("approvalModeSwitch.label")}</span>
            <div className="mt-1 inline-flex w-full rounded-md border bg-surface p-1">
              <button
                type="button"
                data-testid="approval-mode-confirm"
                aria-pressed={approvalMode === "confirm"}
                onClick={() => setApprovalMode("confirm")}
                className={`flex-1 rounded px-3 py-2 text-sm transition ${
                  approvalMode === "confirm"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {t("approvalModeSwitch.options.confirm")}
              </button>
              <button
                type="button"
                data-testid="approval-mode-yolo"
                aria-pressed={approvalMode === "yolo"}
                onClick={() => setApprovalMode("yolo")}
                className={`flex-1 rounded px-3 py-2 text-sm transition ${
                  approvalMode === "yolo"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {t("approvalModeSwitch.options.yolo")}
              </button>
            </div>
          </div>
          <div className="block">
            <span className="text-xs font-medium text-muted-foreground">{t("runtimeConfig.planMode")}</span>
            <div className="mt-1 inline-flex w-full rounded-md border bg-surface p-1">
              <button
                type="button"
                data-testid="plan-mode-advisory"
                aria-pressed={planMode === "advisory"}
                onClick={() => setPlanMode("advisory")}
                className={`flex-1 rounded px-3 py-2 text-sm transition ${
                  planMode === "advisory"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {t("runtimeConfig.planModeOptions.advisory")}
              </button>
              <button
                type="button"
                data-testid="plan-mode-confirm"
                aria-pressed={planMode === "confirm"}
                onClick={() => setPlanMode("confirm")}
                className={`flex-1 rounded px-3 py-2 text-sm transition ${
                  planMode === "confirm"
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-surface-muted hover:text-foreground"
                }`}
              >
                {t("runtimeConfig.planModeOptions.confirm")}
              </button>
            </div>
          </div>
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

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-3 rounded-lg border bg-surface-muted/20 p-4" data-testid="primary-model-config">
            <div className="text-sm font-semibold text-foreground">{t("runtimeConfig.providerTitle")}</div>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerKind")}</span>
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
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerEffort")}</span>
              <select
                value={providerEffort}
                onChange={(event) => setProviderEffort(event.target.value as typeof providerEffort)}
                className="field mt-1"
              >
                <option value="">{t("runtimeConfig.effortDisabled")}</option>
                <option value="low">{t("runtimeConfig.effortOptions.low")}</option>
                <option value="medium">{t("runtimeConfig.effortOptions.medium")}</option>
                <option value="high">{t("runtimeConfig.effortOptions.high")}</option>
                <option value="xhigh">{t("runtimeConfig.effortOptions.xhigh")}</option>
                <option value="max">{t("runtimeConfig.effortOptions.max")}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerMaxTokens")}</span>
              <input
                value={providerMaxTokens}
                onChange={(event) => setProviderMaxTokens(event.target.value)}
                placeholder={t("runtimeConfig.providerMaxTokens")}
                className="field mt-1"
                inputMode="numeric"
              />
            </label>
          </div>

          <div className="space-y-3 rounded-lg border bg-surface-muted/20 p-4" data-testid="embedding-config">
            <div className="text-sm font-semibold text-foreground">{t("runtimeConfig.embeddingTitle")}</div>
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

          <div className="space-y-3 rounded-lg border bg-surface-muted/20 p-4" data-testid="memory-model-config">
            <div className="text-sm font-semibold text-foreground">{t("runtimeConfig.memoryLlmTitle")}</div>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.memoryLlmMode")}</span>
              <select
                value={memoryModelMode}
                onChange={(event) => setMemoryModelMode(event.target.value as MemoryModelMode)}
                className="field mt-1"
                data-testid="memory-model-mode-select"
              >
                {canMirrorPrimaryModel ? (
                  <option value="same_as_primary">{t("runtimeConfig.memoryLlmModeOptions.same_as_primary")}</option>
                ) : null}
                <option value="custom">{t("runtimeConfig.memoryLlmModeOptions.custom")}</option>
              </select>
            </label>
            {memoryModelMode === "custom" ? (
              <>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t("runtimeConfig.memoryLlmProtocol")}</span>
                  <select
                    value={memoryLlmProtocol}
                    onChange={(event) => setMemoryLlmProtocol(event.target.value as "anthropic" | "openai-compatible")}
                    className="field mt-1"
                  >
                    <option value="openai-compatible">{t("runtimeConfig.memoryLlmProtocolOptions.openai-compatible")}</option>
                    <option value="anthropic">{t("runtimeConfig.memoryLlmProtocolOptions.anthropic")}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t("runtimeConfig.memoryLlmBaseUrl")}</span>
                  <input
                    value={memoryLlmBaseUrl}
                    onChange={(event) => setMemoryLlmBaseUrl(event.target.value)}
                    placeholder={t("runtimeConfig.memoryLlmBaseUrl")}
                    className="field mt-1"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t("runtimeConfig.memoryLlmModel")}</span>
                  <input
                    value={memoryLlmModel}
                    onChange={(event) => setMemoryLlmModel(event.target.value)}
                    placeholder={t("runtimeConfig.memoryLlmModel")}
                    className="field mt-1"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t("runtimeConfig.memoryLlmApiKey")}</span>
                  <input
                    type="password"
                    value={memoryLlmApiKey}
                    onChange={(event) => setMemoryLlmApiKey(event.target.value)}
                    placeholder={t("runtimeConfig.memoryLlmApiKey")}
                    className="field mt-1"
                  />
                </label>
              </>
            ) : null}
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.memoryLlmTimeoutMs")}</span>
              <input
                value={memoryLlmTimeoutMs}
                onChange={(event) => setMemoryLlmTimeoutMs(event.target.value)}
                placeholder={t("runtimeConfig.memoryLlmTimeoutMs")}
                className="field mt-1"
                inputMode="numeric"
              />
            </label>
            {memoryModelMode === "custom" ? (
              <>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t("runtimeConfig.memoryLlmEffort")}</span>
                  <select
                    value={memoryLlmEffort}
                    onChange={(event) => setMemoryLlmEffort(event.target.value as typeof memoryLlmEffort)}
                    className="field mt-1"
                  >
                    <option value="">{t("runtimeConfig.effortDisabled")}</option>
                    <option value="low">{t("runtimeConfig.effortOptions.low")}</option>
                    <option value="medium">{t("runtimeConfig.effortOptions.medium")}</option>
                    <option value="high">{t("runtimeConfig.effortOptions.high")}</option>
                    <option value="xhigh">{t("runtimeConfig.effortOptions.xhigh")}</option>
                    <option value="max">{t("runtimeConfig.effortOptions.max")}</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t("runtimeConfig.memoryLlmMaxTokens")}</span>
                  <input
                    value={memoryLlmMaxTokens}
                    onChange={(event) => setMemoryLlmMaxTokens(event.target.value)}
                    placeholder={t("runtimeConfig.memoryLlmMaxTokens")}
                    className="field mt-1"
                    inputMode="numeric"
                  />
                </label>
              </>
            ) : null}
          </div>
        </div>

        <div className="space-y-3 rounded-lg border bg-surface-muted/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-foreground">{t("runtimeConfig.mcpTitle")}</div>
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
        {feedbackMessage ? (
          <p
            className={feedbackMessage.tone === "success" ? "text-sm text-emerald-600" : "text-sm text-amber-600"}
            data-testid="runtime-config-feedback"
          >
            {feedbackMessage.text}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

