"use client";

import React from "react";
import { useEffect, useMemo, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Modal } from "@/components/modal";
import { SelectField } from "@/components/select-field";

import type {
  AgentMemoryMode,
  MnaAgentConfigResponse,
  MnaRuntimeConfigResponse,
  MnaRuntimeGovernanceConfig
} from "../_lib/openapi-types";
import {
  EDITABLE_PROVIDER_KIND_OPTIONS,
  formatProviderKindLabel,
  isEditableProviderKind,
  type EditableProviderKind,
  type ProviderKind
} from "../_lib/provider-kind";
import { useAgentI18n } from "@/lib/i18n/agent/provider";

type SettingsModalProps = {
  open: boolean;
  onClose(): void;
  setupWizard?: boolean;
  config: MnaAgentConfigResponse | null;
  runtimeConfig?: MnaRuntimeConfigResponse | null;
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
    provider?: {
      kind: ProviderKind;
      model: string;
      base_url?: string;
      api_key?: string;
      api_key_env?: string;
      effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
      max_tokens?: number;
    };
    embedding?: {
      base_url?: string;
      model?: string;
      api_key?: string;
    };
    tools?: {
      approval_mode: "confirm" | "yolo";
    };
    planning?: {
      plan_mode: "advisory" | "confirm";
    };
    memory_llm?: {
      base_url?: string;
      model?: string;
      api_key?: string;
      protocol?: EditableProviderKind;
      timeout_ms?: number;
      effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
      max_tokens?: number;
    };
    mcp?: {
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
  onSaveGovernanceConfig?(payload: Partial<MnaRuntimeGovernanceConfig>): Promise<void>;
  onListProviderModels?(payload: {
    kind: EditableProviderKind;
    base_url: string;
    api_key?: string;
    api_key_env?: string;
  }): Promise<{
    models: Array<{
      id: string;
      label: string;
    }>;
  }>;
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
type SetupWizardStep = 1 | 2 | 3;
type SetupProtocolId = EditableProviderKind;
type ProviderApiKeyEnv = "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "DEEPSEEK_API_KEY";

type SetupProtocolPreset = {
  id: SetupProtocolId;
  label: string;
  kind: EditableProviderKind;
  baseUrl: string;
  apiKeyRequired: boolean;
  apiKeyEnv?: ProviderApiKeyEnv;
};

type SetupEnvPreset = {
  preset: SetupProtocolPreset;
  apiKeyEnv: ProviderApiKeyEnv;
  baseUrl: string;
};

const SETUP_PROTOCOL_PRESETS: SetupProtocolPreset[] = [
  {
    id: "openai-compatible",
    label: "OpenAI-compatible (/v1/chat/completions)",
    kind: "openai-compatible",
    baseUrl: "",
    apiKeyRequired: true,
  },
  {
    id: "openai-responses",
    label: "OpenAI Responses (/v1/responses)",
    kind: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    apiKeyRequired: true,
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    id: "anthropic",
    label: "Anthropic Messages (/v1/messages)",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    apiKeyRequired: true,
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    id: "ollama",
    label: "Ollama (/api/chat)",
    kind: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    apiKeyRequired: false,
  },
];

function resolveSetupPreset(protocolId: SetupProtocolId) {
  return SETUP_PROTOCOL_PRESETS.find((preset) => preset.id === protocolId) ?? SETUP_PROTOCOL_PRESETS[0];
}

function resolveSetupPresetFromEnvHint(envName: string | null | undefined): SetupEnvPreset | null {
  if (envName === "OPENAI_API_KEY") {
    const preset = resolveSetupPreset("openai-responses");
    return {
      preset,
      apiKeyEnv: envName,
      baseUrl: preset.baseUrl,
    };
  }

  if (envName === "ANTHROPIC_API_KEY") {
    const preset = resolveSetupPreset("anthropic");
    return {
      preset,
      apiKeyEnv: envName,
      baseUrl: preset.baseUrl,
    };
  }

  if (envName === "DEEPSEEK_API_KEY") {
    return {
      preset: resolveSetupPreset("openai-compatible"),
      apiKeyEnv: envName,
      baseUrl: "https://api.deepseek.com",
    };
  }

  return null;
}

function resolveProviderApiKeyEnv(value: string | null | undefined): ProviderApiKeyEnv | "" {
  return value === "OPENAI_API_KEY" || value === "ANTHROPIC_API_KEY" || value === "DEEPSEEK_API_KEY"
    ? value
    : "";
}

function resolveMemoryProtocolFromProviderKind(kind: ProviderKind): EditableProviderKind | null {
  return isEditableProviderKind(kind) ? kind : null;
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalizeOptionalNumber(value: number | null | undefined) {
  return value ? String(value) : "";
}

function resolveDefaultEmbeddingConfig(kind: ProviderKind, baseUrl: string | null | undefined) {
  if (kind === "ollama") {
    return {
      baseUrl: normalizeText(baseUrl) || "http://127.0.0.1:11434",
      model: "nomic-embed-text",
    };
  }

  if ((kind === "openai-compatible" || kind === "openai-responses") && normalizeText(baseUrl).includes("api.openai.com")) {
    return {
      baseUrl: "https://api.openai.com/v1",
      model: "text-embedding-3-small",
    };
  }

  return null;
}

function hasCustomMemoryLlmConfig(config: MnaAgentConfigResponse) {
  const baseUrl = normalizeText(config.memory_llm.base_url);
  const apiKey = normalizeText(config.memory_llm.api_key);
  const effort = config.memory_llm.effort ?? "";
  const maxTokens = normalizeOptionalNumber(config.memory_llm.max_tokens);

  return Boolean(baseUrl || apiKey || effort || maxTokens);
}

function buildEffortOptions(t: (key: string) => string) {
  return [
    { value: "", label: t("runtimeConfig.effortDisabled") },
    { value: "low", label: t("runtimeConfig.effortOptions.low") },
    { value: "medium", label: t("runtimeConfig.effortOptions.medium") },
    { value: "high", label: t("runtimeConfig.effortOptions.high") },
    { value: "xhigh", label: t("runtimeConfig.effortOptions.xhigh") },
    { value: "max", label: t("runtimeConfig.effortOptions.max") }
  ];
}

function buildSetupModelOptions(models: Array<{ id: string; label: string }>, placeholder: string) {
  return [
    {
      value: "",
      label: placeholder,
    },
    ...models.map((model) => ({
      value: model.id,
      label: model.label,
    })),
  ];
}

function looksLikeOpenAiCompatibleBaseUrl(baseUrl: string) {
  try {
    return new URL(baseUrl).pathname.replace(/\/+$/, "").endsWith("/v1");
  } catch {
    return false;
  }
}

export function SettingsModal({
  open,
  onClose,
  setupWizard = false,
  config,
  runtimeConfig = null,
  dependencyStatus,
  memoryMode,
  onMemoryModeChange,
  onSaveRuntime,
  onSaveGovernanceConfig = async () => undefined,
  onListProviderModels,
  onCheckEmbeddings,
  onCheckMemoryLlm
}: SettingsModalProps) {
  const { formatMemoryModeLabel, t } = useAgentI18n();

  const [providerKind, setProviderKind] = useState<EditableProviderKind>(
    "openai-compatible"
  );
  const [providerKindToSave, setProviderKindToSave] = useState<ProviderKind>("openai-compatible");
  const [providerModel, setProviderModel] = useState("");
  const [providerBaseUrl, setProviderBaseUrl] = useState("");
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerApiKeyEnv, setProviderApiKeyEnv] = useState<ProviderApiKeyEnv | "">("");
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
  const [memoryLlmProtocol, setMemoryLlmProtocol] = useState<EditableProviderKind>("openai-compatible");
  const [memoryLlmTimeoutMs, setMemoryLlmTimeoutMs] = useState("");
  const [memoryLlmEffort, setMemoryLlmEffort] = useState<"low" | "medium" | "high" | "xhigh" | "max" | "">("");
  const [memoryLlmMaxTokens, setMemoryLlmMaxTokens] = useState("");
  const [memoryModelMode, setMemoryModelMode] = useState<MemoryModelMode>("same_as_primary");
  const [governanceEnabled, setGovernanceEnabled] = useState(false);
  const [governanceIntervalMinutes, setGovernanceIntervalMinutes] = useState("15");
  const [governanceVerifyEnabled, setGovernanceVerifyEnabled] = useState(true);
  const [governanceShadowMode, setGovernanceShadowMode] = useState(false);
  const [governanceMaxActions, setGovernanceMaxActions] = useState("10");
  const [mcpServers, setMcpServers] = useState<MnaAgentConfigResponse["mcp"]["servers"]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{ tone: "success" | "warning"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [checkingEmbeddings, setCheckingEmbeddings] = useState(false);
  const [checkingMemoryLlm, setCheckingMemoryLlm] = useState(false);
  const [advancedSettingsOpen, setAdvancedSettingsOpen] = useState(false);
  const [memoryLlmAdvancedOpen, setMemoryLlmAdvancedOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<SetupWizardStep>(1);
  const [setupProtocolId, setSetupProtocolId] = useState<SetupProtocolId>("openai-compatible");
  const [setupApiKey, setSetupApiKey] = useState("");
  const [setupApiKeyEnv, setSetupApiKeyEnv] = useState<ProviderApiKeyEnv | "">("");
  const [setupModel, setSetupModel] = useState("");
  const [setupBaseUrl, setSetupBaseUrl] = useState("");
  const [setupModelOptions, setSetupModelOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [setupModelListStatus, setSetupModelListStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [setupModelListError, setSetupModelListError] = useState<string | null>(null);

  const currentProviderKind: ProviderKind = useMemo(
    () => (isEditableProviderKind(providerKindToSave) ? providerKind : providerKindToSave),
    [providerKind, providerKindToSave],
  );

  const setupProtocol = useMemo(() => resolveSetupPreset(setupProtocolId), [setupProtocolId]);

  const primaryMemoryProtocol = useMemo(
    () => resolveMemoryProtocolFromProviderKind(currentProviderKind),
    [currentProviderKind],
  );

  const canMirrorPrimaryModel = primaryMemoryProtocol !== null;

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
    setProviderApiKeyEnv(resolveProviderApiKeyEnv(config.provider.api_key_env));
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
    setMemoryModelMode(
      mirroredProtocol && (matchesPrimaryModel || !hasCustomMemoryLlmConfig(config))
        ? "same_as_primary"
        : "custom",
    );
    setMcpServers(config.mcp?.servers ?? []);
    setErrorMessage(null);
    setFeedbackMessage(null);
    setSaving(false);
    setCheckingEmbeddings(false);
    setCheckingMemoryLlm(false);
    setAdvancedSettingsOpen(false);
    setMemoryLlmAdvancedOpen(false);
  }, [config, open]);

  useEffect(() => {
    if (!config || config.provider.kind !== "not-configured") {
      return;
    }

    const preset = resolveSetupPresetFromEnvHint(config.env_hints?.provider_api_key_env);
    if (!preset) {
      return;
    }

    setProviderKind(preset.preset.kind);
    setProviderKindToSave(preset.preset.kind);
    setProviderModel("");
    setProviderBaseUrl(preset.baseUrl);
    setProviderApiKey("");
    setProviderApiKeyEnv(preset.apiKeyEnv);
  }, [config]);

  useEffect(() => {
    if (!runtimeConfig) {
      return;
    }

    setGovernanceEnabled(runtimeConfig.governance.WRITEBACK_MAINTENANCE_ENABLED);
    setGovernanceIntervalMinutes(String(Math.max(1, Math.round(runtimeConfig.governance.WRITEBACK_MAINTENANCE_INTERVAL_MS / 60000))));
    setGovernanceVerifyEnabled(runtimeConfig.governance.WRITEBACK_GOVERNANCE_VERIFY_ENABLED);
    setGovernanceShadowMode(runtimeConfig.governance.WRITEBACK_GOVERNANCE_SHADOW_MODE);
    setGovernanceMaxActions(String(runtimeConfig.governance.WRITEBACK_MAINTENANCE_MAX_ACTIONS));
  }, [runtimeConfig, open]);

  useEffect(() => {
    if (!canMirrorPrimaryModel && memoryModelMode === "same_as_primary") {
      setMemoryModelMode("custom");
    }
  }, [canMirrorPrimaryModel, memoryModelMode]);

  useEffect(() => {
    if (memoryModelMode !== "custom") {
      setMemoryLlmAdvancedOpen(false);
    }
  }, [memoryModelMode]);

  useEffect(() => {
    const defaultEmbedding = resolveDefaultEmbeddingConfig(currentProviderKind, providerBaseUrl);
    if (!defaultEmbedding) {
      return;
    }

    setEmbeddingBaseUrl((current) => current.trim() ? current : defaultEmbedding.baseUrl);
    setEmbeddingModel((current) => current.trim() ? current : defaultEmbedding.model);
  }, [currentProviderKind, providerBaseUrl]);

  useEffect(() => {
    if (!open || !setupWizard) {
      return;
    }

    const preset = SETUP_PROTOCOL_PRESETS[0];
    setSetupStep(1);
    const envPreset = resolveSetupPresetFromEnvHint(config?.env_hints?.provider_api_key_env);
    const nextPreset = envPreset?.preset ?? preset;
    setSetupProtocolId(nextPreset.id);
    setSetupApiKey("");
    setSetupApiKeyEnv(envPreset?.apiKeyEnv ?? "");
    setSetupModel("");
    setSetupBaseUrl(envPreset?.baseUrl ?? nextPreset.baseUrl);
    setSetupModelOptions([]);
    setSetupModelListStatus("idle");
    setSetupModelListError(null);
    setErrorMessage(null);
    setFeedbackMessage(null);
    setSaving(false);
  }, [open, setupWizard, config?.env_hints?.provider_api_key_env]);

  const providerRequiresBaseUrl = useMemo(
    () => currentProviderKind === "openai-compatible" || currentProviderKind === "openai-responses" || currentProviderKind === "anthropic" || currentProviderKind === "ollama",
    [currentProviderKind],
  );

  const providerRequiresApiKey = useMemo(
    () => currentProviderKind === "openai-compatible" || currentProviderKind === "openai-responses" || currentProviderKind === "anthropic",
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
    const trimmedGovernanceIntervalMinutes = governanceIntervalMinutes.trim();
    const trimmedGovernanceMaxActions = governanceMaxActions.trim();

    if (!trimmedProviderModel) {
      setErrorMessage(t("runtimeConfig.errors.providerModelRequired"));
      return;
    }

    if (providerRequiresBaseUrl && !trimmedProviderBaseUrl) {
      setErrorMessage(t("runtimeConfig.errors.providerBaseUrlRequired"));
      return;
    }

    if (providerRequiresApiKey && !trimmedProviderApiKey && !providerApiKeyEnv) {
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

    if (!/^\d+$/.test(trimmedGovernanceIntervalMinutes) || Number(trimmedGovernanceIntervalMinutes) < 1) {
      setErrorMessage(t("runtimeConfig.errors.governanceIntervalInvalid"));
      return;
    }

    if (
      !/^\d+$/.test(trimmedGovernanceMaxActions)
      || Number(trimmedGovernanceMaxActions) < 1
      || Number(trimmedGovernanceMaxActions) > 20
    ) {
      setErrorMessage(t("runtimeConfig.errors.governanceMaxActionsInvalid"));
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
          ...(!trimmedProviderApiKey && providerApiKeyEnv ? { api_key_env: providerApiKeyEnv } : {}),
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
      await onSaveGovernanceConfig({
        WRITEBACK_MAINTENANCE_ENABLED: governanceEnabled,
        WRITEBACK_MAINTENANCE_INTERVAL_MS: Number(trimmedGovernanceIntervalMinutes) * 60_000,
        WRITEBACK_GOVERNANCE_VERIFY_ENABLED: governanceVerifyEnabled,
        WRITEBACK_GOVERNANCE_SHADOW_MODE: governanceShadowMode,
        WRITEBACK_MAINTENANCE_MAX_ACTIONS: Number(trimmedGovernanceMaxActions),
      });
      onClose();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function selectSetupProtocol(protocolId: SetupProtocolId) {
    const preset = resolveSetupPreset(protocolId);
    const detectedEnvName = config?.env_hints?.provider_api_key_env;
    let detectedApiKeyEnv: ProviderApiKeyEnv | "" = "";
    if (detectedEnvName === "DEEPSEEK_API_KEY" && protocolId === "openai-compatible") {
      detectedApiKeyEnv = "DEEPSEEK_API_KEY";
    } else if (preset.apiKeyEnv && preset.apiKeyEnv === detectedEnvName) {
      detectedApiKeyEnv = preset.apiKeyEnv;
    }
    const detectedBaseUrl = detectedApiKeyEnv === "DEEPSEEK_API_KEY" ? "https://api.deepseek.com" : "";
    const nextBaseUrl = detectedBaseUrl || preset.baseUrl;
    const currentBaseUrl = setupBaseUrl.trim();
    const previousDefaultBaseUrls = [setupProtocol.baseUrl, "https://api.deepseek.com"].filter(Boolean);
    const shouldUseDefaultBaseUrl = !currentBaseUrl || previousDefaultBaseUrls.includes(currentBaseUrl);
    setSetupProtocolId(protocolId);
    setSetupApiKey("");
    setSetupApiKeyEnv(resolveProviderApiKeyEnv(detectedApiKeyEnv));
    setSetupModel("");
    setSetupBaseUrl(shouldUseDefaultBaseUrl ? nextBaseUrl : setupBaseUrl);
    setSetupModelOptions([]);
    setSetupModelListStatus("idle");
    setSetupModelListError(null);
    setErrorMessage(null);
  }

  async function handleSetupNext() {
    if (setupStep === 1 && !setupBaseUrl.trim()) {
      setErrorMessage(t("runtimeConfig.errors.providerBaseUrlRequired"));
      return;
    }

    if (setupStep === 1 && setupProtocol.kind === "ollama" && looksLikeOpenAiCompatibleBaseUrl(setupBaseUrl.trim())) {
      setErrorMessage(t("runtimeConfig.errors.providerKindMismatch"));
      return;
    }

    if (setupStep === 2 && setupProtocol.apiKeyRequired && !setupApiKey.trim() && !setupApiKeyEnv) {
      setErrorMessage(t("runtimeConfig.errors.providerApiKeyRequired"));
      return;
    }

    if (setupStep === 2) {
      if (!onListProviderModels) {
        setSetupModelListStatus("error");
        setSetupModelListError(t("runtimeConfig.setupWizard.modelListUnavailable"));
      } else {
        setErrorMessage(null);
        setSetupModel("");
        setSetupModelOptions([]);
        setSetupModelListStatus("loading");
        setSetupModelListError(null);

        try {
          const result = await onListProviderModels({
            kind: setupProtocol.kind,
            base_url: setupBaseUrl.trim(),
            ...(setupApiKey.trim() ? { api_key: setupApiKey.trim() } : {}),
            ...(!setupApiKey.trim() && setupApiKeyEnv ? { api_key_env: setupApiKeyEnv } : {}),
          });
          setSetupModelOptions(result.models);
          setSetupModelListStatus(result.models.length > 0 ? "ready" : "error");
          setSetupModelListError(result.models.length > 0 ? null : t("runtimeConfig.setupWizard.modelListEmpty"));
        } catch (error) {
          setSetupModelOptions([]);
          setSetupModelListStatus("error");
          setSetupModelListError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    setErrorMessage(null);
    setSetupStep((current) => (current < 3 ? ((current + 1) as SetupWizardStep) : current));
  }

  async function handleSetupSave() {
    const trimmedModel = setupModel.trim();
    const trimmedBaseUrl = setupBaseUrl.trim();
    const trimmedApiKey = setupApiKey.trim();

    if (!trimmedModel) {
      setErrorMessage(t("runtimeConfig.errors.providerModelRequired"));
      return;
    }

    if (!trimmedBaseUrl) {
      setErrorMessage(t("runtimeConfig.errors.providerBaseUrlRequired"));
      return;
    }

    if (setupProtocol.apiKeyRequired && !trimmedApiKey && !setupApiKeyEnv) {
      setErrorMessage(t("runtimeConfig.errors.providerApiKeyRequired"));
      return;
    }

    setErrorMessage(null);
    setFeedbackMessage(null);
    setSaving(true);
    try {
      await onSaveRuntime({
        provider: {
          kind: setupProtocol.kind,
          model: trimmedModel,
          base_url: trimmedBaseUrl,
          ...(trimmedApiKey ? { api_key: trimmedApiKey } : {}),
          ...(!trimmedApiKey && setupApiKeyEnv ? { api_key_env: setupApiKeyEnv } : {}),
          effort: null,
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

  if (setupWizard) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={t("runtimeConfig.setupWizard.title")}
        description={t("runtimeConfig.setupWizard.description")}
        size="lg"
        footer={
          <>
            <button type="button" onClick={onClose} className="btn-outline">
              {t("promptInspector.close")}
            </button>
            {setupStep > 1 ? (
              <button
                type="button"
                onClick={() => setSetupStep((current) => (current > 1 ? ((current - 1) as SetupWizardStep) : current))}
                className="btn-outline"
                data-testid="setup-wizard-back"
              >
                {t("runtimeConfig.setupWizard.back")}
              </button>
            ) : null}
            {setupStep < 3 ? (
              <button
                type="button"
                onClick={() => {
                  void handleSetupNext();
                }}
                disabled={setupModelListStatus === "loading"}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="setup-wizard-next"
              >
                {t("runtimeConfig.setupWizard.next")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void handleSetupSave();
                }}
                disabled={saving}
                className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="setup-wizard-save"
              >
                {saving ? t("runtimeConfig.saving") : t("runtimeConfig.setupWizard.finish")}
              </button>
            )}
          </>
        }
      >
        <div className="space-y-5" data-testid="provider-setup-wizard">
          {errorMessage ? (
            <p className="text-sm text-[var(--ink)]" data-testid="runtime-config-error">
              {errorMessage}
            </p>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-3">
            {([1, 2, 3] as SetupWizardStep[]).map((step) => (
              <div
                key={step}
                className={`rounded-md border px-3 py-2 text-sm ${
                  setupStep === step ? "border-accent bg-accent/10 text-foreground" : "bg-surface-muted/30 text-muted-foreground"
                }`}
              >
                <div className="text-xs font-semibold">{t(`runtimeConfig.setupWizard.steps.${step}`)}</div>
              </div>
            ))}
          </div>

          {setupStep === 1 ? (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-foreground">
                {t("runtimeConfig.setupWizard.protocolStepTitle")}
              </div>
              <label className="block">
                <span className="text-xs text-muted-foreground">{t("runtimeConfig.setupWizard.baseUrlLabel")}</span>
                <input
                  aria-label={t("runtimeConfig.setupWizard.baseUrlLabel")}
                  value={setupBaseUrl}
                  onChange={(event) => {
                    setSetupBaseUrl(event.target.value);
                    setSetupModel("");
                    setSetupModelOptions([]);
                    setSetupModelListStatus("idle");
                    setSetupModelListError(null);
                  }}
                  placeholder={t("runtimeConfig.setupWizard.baseUrlLabel")}
                  className="field mt-1"
                  data-testid="setup-provider-base-url"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">{t("runtimeConfig.setupWizard.protocolLabel")}</span>
                <SelectField
                  value={setupProtocolId}
                  onChange={(value) => selectSetupProtocol(value as SetupProtocolId)}
                  options={SETUP_PROTOCOL_PRESETS.map((preset) => ({
                    value: preset.id,
                    label: preset.label,
                  }))}
                  ariaLabel={t("runtimeConfig.setupWizard.protocolLabel")}
                  testId="setup-protocol-select"
                />
              </label>
            </div>
          ) : null}

          {setupStep === 2 ? (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-foreground">
                {t("runtimeConfig.setupWizard.apiKeyStepTitle")}
              </div>
              {setupProtocol.apiKeyRequired ? (
                <div className="space-y-3">
                  {setupApiKeyEnv ? (
                    <div
                      className="rounded-md border bg-surface-muted/30 px-3 py-3 text-sm text-muted-foreground"
                      data-testid="setup-api-key-env-detected"
                    >
                      {t("runtimeConfig.setupWizard.apiKeyEnvDetected", { name: setupApiKeyEnv })}
                    </div>
                  ) : null}
                  <label className="block">
                    <span className="text-xs text-muted-foreground">{t("runtimeConfig.setupWizard.apiKeyLabel")}</span>
                    <input
                      aria-label={t("runtimeConfig.setupWizard.apiKeyLabel")}
                      type="password"
                      value={setupApiKey}
                      onChange={(event) => {
                        setSetupApiKey(event.target.value);
                        if (event.target.value.trim()) {
                          setSetupApiKeyEnv("");
                        }
                        setSetupModel("");
                        setSetupModelOptions([]);
                        setSetupModelListStatus("idle");
                        setSetupModelListError(null);
                      }}
                      placeholder={t("runtimeConfig.setupWizard.apiKeyPlaceholder")}
                      className="field mt-1"
                    />
                  </label>
                </div>
              ) : (
                <div
                  className="rounded-md border bg-surface-muted/30 px-3 py-3 text-sm text-muted-foreground"
                  data-testid="setup-api-key-optional"
                >
                  {t("runtimeConfig.setupWizard.ollamaNoApiKey")}
                </div>
              )}
              {setupModelListStatus === "loading" ? (
                <div className="rounded-md border bg-surface-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  {t("runtimeConfig.setupWizard.loadingModels")}
                </div>
              ) : null}
            </div>
          ) : null}

          {setupStep === 3 ? (
            <div className="space-y-3">
              <div className="text-sm font-semibold text-foreground">
                {t("runtimeConfig.setupWizard.modelStepTitle")}
              </div>
              {setupModelListStatus === "ready" ? (
                <label className="block">
                  <span className="text-xs text-muted-foreground">{t("runtimeConfig.setupWizard.modelLabel")}</span>
                  <SelectField
                    value={setupModel}
                    onChange={setSetupModel}
                    options={buildSetupModelOptions(
                      setupModelOptions,
                      t("runtimeConfig.setupWizard.modelSelectPlaceholder"),
                    )}
                    ariaLabel={t("runtimeConfig.setupWizard.modelLabel")}
                    testId="setup-model-select"
                  />
                </label>
              ) : (
                <>
                  {setupModelListError ? (
                    <div
                      className="rounded-md border bg-surface-muted/30 px-3 py-3 text-sm text-muted-foreground"
                      data-testid="setup-model-list-error"
                    >
                      {t("runtimeConfig.setupWizard.modelListFallback")}: {setupModelListError}
                    </div>
                  ) : null}
                  <label className="block">
                    <span className="text-xs text-muted-foreground">{t("runtimeConfig.setupWizard.modelLabel")}</span>
                    <input
                      aria-label={t("runtimeConfig.setupWizard.modelLabel")}
                      value={setupModel}
                      onChange={(event) => setSetupModel(event.target.value)}
                      placeholder={t("runtimeConfig.providerModel")}
                      className="field mt-1"
                    />
                  </label>
                </>
              )}
            </div>
          ) : null}
        </div>
      </Modal>
    );
  }

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
        {errorMessage ? (
          <p className="text-sm text-[var(--ink)]" data-testid="runtime-config-error">
            {errorMessage}
          </p>
        ) : null}
        {feedbackMessage ? (
          <p
            className={feedbackMessage.tone === "success" ? "text-sm text-[var(--primary)]" : "text-sm text-muted-foreground"}
            data-testid="runtime-config-feedback"
          >
            {feedbackMessage.text}
          </p>
        ) : null}

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

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="text-xs font-semibold text-muted-foreground">{t("modeSwitch.label")}</span>
            <div className="mt-1">
              <SelectField
                testId="memory-mode-select"
                value={memoryMode}
                onChange={(value) => onMemoryModeChange(value as AgentMemoryMode)}
                options={[
                  { value: "workspace_plus_global", label: formatMemoryModeLabel("workspace_plus_global") },
                  { value: "workspace_only", label: formatMemoryModeLabel("workspace_only") }
                ]}
              />
            </div>
          </label>
          <div className="block">
            <span className="text-xs font-semibold text-muted-foreground">{t("approvalModeSwitch.label")}</span>
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
            <span className="text-xs font-semibold text-muted-foreground">{t("runtimeConfig.planMode")}</span>
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
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            className="btn-outline"
            aria-expanded={advancedSettingsOpen}
            data-testid="advanced-settings-toggle"
            onClick={() => setAdvancedSettingsOpen((current) => !current)}
          >
            {advancedSettingsOpen ? t("runtimeConfig.hideAdvancedSettings") : t("runtimeConfig.advancedSettings")}
          </button>
        </div>

        <div className={`grid gap-4 ${advancedSettingsOpen ? "md:grid-cols-3" : "md:grid-cols-1"}`}>
          <div className="space-y-3 rounded-lg border bg-surface-muted/20 p-4" data-testid="primary-model-config">
            <div className="text-sm font-semibold text-foreground">{t("runtimeConfig.providerTitle")}</div>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerKind")}</span>
              <SelectField
                value={isEditableProviderKind(providerKindToSave) ? providerKind : providerKindToSave}
                onChange={(value) => {
                  const nextKind = value as EditableProviderKind;
                  setProviderKind(nextKind);
                  setProviderKindToSave(nextKind);
                }}
                options={providerKindOptions}
              />
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
                onChange={(event) => {
                  setProviderApiKey(event.target.value);
                  if (event.target.value.trim()) {
                    setProviderApiKeyEnv("");
                  }
                }}
                placeholder={t("runtimeConfig.providerApiKey")}
                className="field mt-1"
              />
              {providerApiKeyEnv ? (
                <span className="mt-1 block text-xs text-muted-foreground" data-testid="runtime-config-provider-api-key-env">
                  {t("runtimeConfig.setupWizard.apiKeyEnvDetected", { name: providerApiKeyEnv })}
                </span>
              ) : null}
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerEffort")}</span>
              <SelectField
                value={providerEffort}
                onChange={(value) => setProviderEffort(value as typeof providerEffort)}
                options={buildEffortOptions(t)}
              />
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

          {advancedSettingsOpen ? (
            <>
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
                  <SelectField
                    value={memoryModelMode}
                    testId="memory-model-mode-select"
                    onChange={(value) => setMemoryModelMode(value as MemoryModelMode)}
                    options={[
                      ...(canMirrorPrimaryModel
                        ? [{ value: "same_as_primary", label: t("runtimeConfig.memoryLlmModeOptions.same_as_primary") }]
                        : []),
                      { value: "custom", label: t("runtimeConfig.memoryLlmModeOptions.custom") }
                    ]}
                  />
                </label>
                {memoryModelMode === "custom" ? (
                  <>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerKind")}</span>
                      <SelectField
                        value={memoryLlmProtocol}
                        ariaLabel={t("runtimeConfig.providerKind")}
                        onChange={(value) => setMemoryLlmProtocol(value as EditableProviderKind)}
                        options={EDITABLE_PROVIDER_KIND_OPTIONS}
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerModel")}</span>
                      <input
                        value={memoryLlmModel}
                        onChange={(event) => setMemoryLlmModel(event.target.value)}
                        placeholder={t("runtimeConfig.providerModel")}
                        className="field mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerBaseUrl")}</span>
                      <input
                        value={memoryLlmBaseUrl}
                        onChange={(event) => setMemoryLlmBaseUrl(event.target.value)}
                        placeholder={t("runtimeConfig.providerBaseUrl")}
                        className="field mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerApiKey")}</span>
                      <input
                        type="password"
                        value={memoryLlmApiKey}
                        onChange={(event) => setMemoryLlmApiKey(event.target.value)}
                        placeholder={t("runtimeConfig.providerApiKey")}
                        className="field mt-1"
                      />
                    </label>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="btn-outline"
                        aria-expanded={memoryLlmAdvancedOpen}
                        data-testid="memory-model-advanced-toggle"
                        onClick={() => setMemoryLlmAdvancedOpen((current) => !current)}
                      >
                        {memoryLlmAdvancedOpen
                          ? t("runtimeConfig.memoryLlmHideAdvancedSettings")
                          : t("runtimeConfig.memoryLlmAdvancedSettings")}
                      </button>
                    </div>
                  </>
                ) : null}
                {memoryModelMode === "same_as_primary" ? (
                  <>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerKind")}</span>
                      <SelectField
                        value={currentProviderKind}
                        ariaLabel={t("runtimeConfig.providerKind")}
                        onChange={() => undefined}
                        options={providerKindOptions}
                        disabled
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerModel")}</span>
                      <input
                        value={providerModel}
                        readOnly
                        placeholder={t("runtimeConfig.providerModel")}
                        className="field mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerBaseUrl")}</span>
                      <input
                        value={providerBaseUrl}
                        readOnly
                        placeholder={t("runtimeConfig.providerBaseUrl")}
                        className="field mt-1"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs text-muted-foreground">{t("runtimeConfig.providerApiKey")}</span>
                      <input
                        type="password"
                        value={providerApiKey}
                        readOnly
                        placeholder={t("runtimeConfig.providerApiKey")}
                        className="field mt-1"
                      />
                    </label>
                  </>
                ) : null}
                {memoryModelMode === "custom" && memoryLlmAdvancedOpen ? (
                  <>
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
                    <label className="block">
                      <span className="text-xs text-muted-foreground">{t("runtimeConfig.memoryLlmEffort")}</span>
                      <SelectField
                        value={memoryLlmEffort}
                        ariaLabel={t("runtimeConfig.memoryLlmEffort")}
                        onChange={(value) => setMemoryLlmEffort(value as typeof memoryLlmEffort)}
                        options={buildEffortOptions(t)}
                      />
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
            </>
          ) : null}
        </div>

        <div className="space-y-4 rounded-lg border bg-surface-muted/20 p-4" data-testid="governance-config">
          <div className="text-sm font-semibold text-foreground">{t("runtimeConfig.governanceTitle")}</div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={governanceEnabled}
                onChange={(event) => setGovernanceEnabled(event.target.checked)}
                className="h-4 w-4"
              />
              {t("runtimeConfig.governanceEnabled")}
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={governanceVerifyEnabled}
                onChange={(event) => setGovernanceVerifyEnabled(event.target.checked)}
                className="h-4 w-4"
              />
              {t("runtimeConfig.governanceVerifyEnabled")}
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={governanceShadowMode}
                onChange={(event) => setGovernanceShadowMode(event.target.checked)}
                className="h-4 w-4"
              />
              {t("runtimeConfig.governanceShadowMode")}
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.governanceIntervalMinutes")}</span>
              <input
                value={governanceIntervalMinutes}
                onChange={(event) => setGovernanceIntervalMinutes(event.target.value)}
                placeholder={t("runtimeConfig.governanceIntervalMinutes")}
                className="field mt-1"
                inputMode="numeric"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">{t("runtimeConfig.governanceMaxActions")}</span>
              <input
                value={governanceMaxActions}
                onChange={(event) => setGovernanceMaxActions(event.target.value)}
                placeholder={t("runtimeConfig.governanceMaxActions")}
                className="field mt-1"
                inputMode="numeric"
              />
            </label>
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
                    <SelectField
                      value={server.transport}
                      onChange={(value) => {
                        const nextTransport = value as "stdio" | "http";
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
                      options={[
                        { value: "http", label: "http" },
                        { value: "stdio", label: "stdio" }
                      ]}
                    />
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

      </div>
    </Modal>
  );
}
