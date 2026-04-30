"use client";

import type { Route } from "next";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { createTranslator } from "@/lib/i18n/messages";

import { initialAgentState, reduceAgentEvent } from "../_lib/event-reducer";
import type {
  AgentApprovalMode,
  AgentLocale,
  AgentMemoryMode,
  AgentPlanMode,
  MnaPromptInspectorResponse,
  MnaSessionSummary,
  MnaSkillSummary,
  MnaWorkspaceSummary
} from "../_lib/openapi-types";
import { MnaRequestError, MnaUnavailableError } from "../_lib/mna-client";
import { useAgentClient } from "./use-agent-client";

type UseAgentWorkspaceOptions = {
  sessionId?: string;
  uiLocale: AgentLocale;
};

const FILE_TREE_PATH_STORAGE_KEY = "axis.agent.fileTree.path";
const FILE_TREE_SELECTED_FILE_STORAGE_KEY = "axis.agent.fileTree.selectedFile";
const FILE_TREE_WORKSPACE_STORAGE_KEY = "axis.agent.fileTree.workspace";
const LAST_SESSION_ID_STORAGE_KEY = "axis.agent.lastSessionId";

function readSessionIdFromPath(pathname: string) {
  const [, route, sessionId] = pathname.split("/");
  return route === "agent" && sessionId ? decodeURIComponent(sessionId) : null;
}

export function useAgentWorkspace(options: UseAgentWorkspaceOptions) {
  const client = useAgentClient();
  const [state, dispatch] = useReducer(reduceAgentEvent, initialAgentState);
  const [treePath, setTreePath] = useState(".");
  const [fileTree, setFileTree] = useState<{ path: string; entries: Array<{ name: string; type: "directory" | "file" | "other" }> }>({
    path: ".",
    entries: []
  });
  const [workspaceList, setWorkspaceList] = useState<MnaWorkspaceSummary[]>([]);
  const [skillList, setSkillList] = useState<MnaSkillSummary[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string } | null>(null);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof client.getMetrics>> | null>(null);
  const [dependencyStatus, setDependencyStatus] = useState<Awaited<ReturnType<typeof client.getDependencyStatus>> | null>(null);
  const [agentConfig, setAgentConfig] = useState<Awaited<ReturnType<typeof client.getConfig>> | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<Awaited<ReturnType<typeof client.getRuntimeConfig>> | null>(null);
  const [mcpState, setMcpState] = useState<Awaited<ReturnType<typeof client.getMcpServers>> | null>(null);
  const [promptInspector, setPromptInspector] = useState<MnaPromptInspectorResponse | null>(null);
  const [promptInspectorOpen, setPromptInspectorOpen] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [sessionCatalogLoaded, setSessionCatalogLoaded] = useState(false);
  const [routeSessionId, setRouteSessionId] = useState<string | null>(options.sessionId ?? null);
  const streamRef = useRef<ReturnType<typeof client.connectSessionStream> | null>(null);
  const streamGenerationRef = useRef(0);

  useEffect(() => {
    setRouteSessionId(options.sessionId ?? null);
  }, [options.sessionId]);

  useEffect(() => {
    function handlePopState() {
      setRouteSessionId(readSessionIdFromPath(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  useEffect(() => {
    const savedTreePath = window.localStorage.getItem(FILE_TREE_PATH_STORAGE_KEY);
    const savedSelectedFile = window.localStorage.getItem(FILE_TREE_SELECTED_FILE_STORAGE_KEY);
    const savedWorkspaceId = window.localStorage.getItem(FILE_TREE_WORKSPACE_STORAGE_KEY);

    if (savedTreePath) {
      setTreePath(savedTreePath);
      setFileTree((current) => ({
        ...current,
        path: savedTreePath,
      }));
    }

    setSelectedFilePath(savedSelectedFile);
    setSelectedWorkspaceId(savedWorkspaceId);
  }, []);

  useEffect(() => {
    if (!state.sessionId) {
      return;
    }

    window.localStorage.setItem(LAST_SESSION_ID_STORAGE_KEY, state.sessionId);
  }, [state.sessionId]);

  function toAgentRoute(sessionId: string) {
    return `/agent/${sessionId}` as Route;
  }

  function syncAgentRoute(sessionId: string, mode: "push" | "replace" | "none" = "push") {
    if (mode === "none") {
      return;
    }

    const nextPath = toAgentRoute(sessionId);
    setRouteSessionId(sessionId);
    if (window.location.pathname === nextPath && !window.location.search) {
      return;
    }

    if (mode === "replace") {
      window.history.replaceState(null, "", nextPath);
      return;
    }

    window.history.pushState(null, "", nextPath);
  }

  function isRecoverableSessionError(error: unknown) {
    return (
      error instanceof MnaRequestError &&
      (error.code === "session_not_found" || error.code === "workspace_mismatch")
    );
  }

  async function restoreAvailableSessionOrCreate(sessionItems: MnaSessionSummary[], fallbackSessionId?: string) {
    const existingSessionId = fallbackSessionId
      ? sessionItems.find((item) => item.id !== fallbackSessionId)?.id
      : sessionItems[0]?.id;
    if (existingSessionId) {
      await openSession(existingSessionId, { routeMode: "replace" });
      return;
    }

    const created = await client.createSession({
      locale: options.uiLocale
    });
    await openSession(created.session_id, {
      routeMode: "replace",
      requestedWorkspaceId: created.workspace_id ?? undefined
    });
  }

  useEffect(() => {
    let cancelled = false;
    setSessionCatalogLoaded(false);

    const bootstrap = async () => {
      const bootstrapResult = await client.bootstrap();
      if (cancelled) {
        return;
      }

      dispatch({
        type: "bootstrap_loaded",
        bootstrapStatus: bootstrapResult.status,
        reason: bootstrapResult.reason
      });

      if (bootstrapResult.status !== "ok") {
        return;
      }

      const [sessionList, workspaces, skills] = await Promise.all([
        client.listSessions(),
        client.listWorkspaces(),
        client.listSkills()
      ]);
      if (cancelled) {
        return;
      }

      setWorkspaceList(workspaces.items);
      setSkillList(skills.items);
      setSessionCatalogLoaded(true);
      dispatch({
        type: "session_list_loaded",
        items: sessionList.items
      });
    };

    void bootstrap().catch((error) => {
      if (cancelled) {
        return;
      }

      dispatch({
        type: "bootstrap_loaded",
        bootstrapStatus: error instanceof MnaUnavailableError ? error.status : "token_invalid",
        reason: error instanceof Error ? error.message : String(error)
      });
    });

    return () => {
      cancelled = true;
    };
  }, [bootstrapAttempt, client]);

  useEffect(() => {
    return () => {
      streamGenerationRef.current += 1;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (state.bootstrapStatus !== "ok") {
      return;
    }

    let cancelled = false;

    const syncRouteSession = async () => {
      if (routeSessionId) {
        if (state.sessionId === routeSessionId) {
          return;
        }

        try {
          await openSession(routeSessionId, { routeMode: "replace" });
        } catch (error) {
          if (cancelled) {
            return;
          }
          if (!isRecoverableSessionError(error)) {
            throw error;
          }

          const sessionItems =
            state.sessionList.length > 0
              ? state.sessionList
              : (await client.listSessions()).items;
          if (cancelled) {
            return;
          }
          if (state.sessionList.length === 0) {
            dispatch({
              type: "session_list_loaded",
              items: sessionItems
            });
          }
          await restoreAvailableSessionOrCreate(sessionItems, routeSessionId);
        }
        return;
      }

      if (!sessionCatalogLoaded) {
        return;
      }

      const lastSessionId = window.localStorage.getItem(LAST_SESSION_ID_STORAGE_KEY);
      const existingSessionId =
        (lastSessionId ? state.sessionList.find((item) => item.id === lastSessionId)?.id : undefined) ??
        state.sessionList[0]?.id;
      if (existingSessionId) {
        await openSession(existingSessionId, { routeMode: "replace" });
        return;
      }

      const created = await client.createSession({
        locale: options.uiLocale
      });
      if (cancelled) {
        return;
      }

      await openSession(created.session_id, {
        routeMode: "replace",
        requestedWorkspaceId: created.workspace_id ?? undefined
      });
    };

    void syncRouteSession().catch((error) => {
      if (cancelled) {
        return;
      }

      dispatch({
        type: "bootstrap_loaded",
        bootstrapStatus: error instanceof MnaUnavailableError ? error.status : "token_invalid",
        reason: error instanceof Error ? error.message : String(error)
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    client,
    options.uiLocale,
    routeSessionId,
    sessionCatalogLoaded,
    state.bootstrapStatus,
    state.sessionId,
    state.sessionList
  ]);

  useEffect(() => {
    if (state.bootstrapStatus === "ok" || state.bootstrapStatus === "loading") {
      return;
    }

    const timer = window.setTimeout(() => {
      setBootstrapAttempt((value) => value + 1);
    }, 1500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [state.bootstrapStatus]);

  const activeTurn = useMemo(() => state.turns.at(-1) ?? null, [state.turns]);

  async function refreshMetrics() {
    setMetrics(await client.getMetrics());
  }

  async function refreshDependencyStatus() {
    setDependencyStatus(await client.getDependencyStatus());
  }

  async function refreshAgentConfig() {
    setAgentConfig(await client.getConfig());
  }

  async function refreshRuntimeConfig() {
    setRuntimeConfig(await client.getRuntimeConfig());
  }

  async function refreshMcpState() {
    setMcpState(await client.getMcpServers());
  }

  async function refreshWorkspaceList() {
    const payload = await client.listWorkspaces();
    setWorkspaceList(payload.items);
    return payload.items;
  }

  function mergeDependencyProbe(
    current: Awaited<ReturnType<typeof client.getDependencyStatus>> | null,
    name: "embeddings" | "memory_llm",
    result: Awaited<ReturnType<typeof client.checkEmbeddings>>,
  ) {
    if (!current) {
      return current;
    }

    return {
      ...current,
      runtime: {
        ...current.runtime,
        [name]: {
          ...(current.runtime[name] ?? {}),
          status: result.status,
          detail: result.detail,
          last_checked_at: result.last_checked_at,
        },
      },
    };
  }

  async function refreshSkillList() {
    const payload = await client.listSkills();
    setSkillList(payload.items);
    return payload.items;
  }

  function persistWorkspaceSelection(
    workspaceId: string | null,
    options: {
      treePath?: string;
      selectedFilePath?: string | null;
    } = {}
  ) {
    const nextTreePath = options.treePath ?? ".";
    const nextSelectedFilePath = options.selectedFilePath ?? null;

    setSelectedWorkspaceId(workspaceId);
    setTreePath(nextTreePath);
    setFileTree({
      path: nextTreePath,
      entries: []
    });
    setSelectedFilePath(nextSelectedFilePath);
    setSelectedFile(null);
    if (nextSelectedFilePath) {
      window.localStorage.setItem(FILE_TREE_SELECTED_FILE_STORAGE_KEY, nextSelectedFilePath);
    } else {
      window.localStorage.removeItem(FILE_TREE_SELECTED_FILE_STORAGE_KEY);
    }

    if (workspaceId) {
      window.localStorage.setItem(FILE_TREE_WORKSPACE_STORAGE_KEY, workspaceId);
      window.localStorage.setItem(FILE_TREE_PATH_STORAGE_KEY, nextTreePath);
      return;
    }

    window.localStorage.removeItem(FILE_TREE_WORKSPACE_STORAGE_KEY);
    window.localStorage.removeItem(FILE_TREE_PATH_STORAGE_KEY);
  }

  async function refreshFileTree(nextPath = treePath, workspaceId = selectedWorkspaceId) {
    if (!workspaceId) {
      setTreePath(".");
      setFileTree({
        path: ".",
        entries: []
      });
      return;
    }

    const payload = await client.getFileTree(nextPath, workspaceId);
    setTreePath(payload.path);
    setFileTree(payload);
    window.localStorage.setItem(FILE_TREE_PATH_STORAGE_KEY, payload.path);
  }

  async function openFile(filePath: string, workspaceId = selectedWorkspaceId) {
    if (!workspaceId) {
      return;
    }

    const payload = await client.getFile(filePath, workspaceId);
    setSelectedFilePath(payload.path);
    setSelectedFile(payload);
    window.localStorage.setItem(FILE_TREE_SELECTED_FILE_STORAGE_KEY, payload.path);
  }

  function selectWorkspace(workspaceId: string | null) {
    persistWorkspaceSelection(workspaceId);

    if (workspaceId) {
      void client.getFileTree(".", workspaceId).then((payload) => {
        setTreePath(payload.path);
        setFileTree(payload);
      }).catch(() => {
        setTreePath(".");
        setFileTree({
          path: ".",
          entries: []
        });
      });
    }
  }

  async function openOrCreateSessionForWorkspace(workspaceId: string) {
    const knownSessionId = state.sessionList.find((item) => item.workspace_id === workspaceId)?.id;
    if (knownSessionId) {
      await openSession(knownSessionId);
      return knownSessionId;
    }

    const scopedSessions = await client.listSessions(workspaceId);
    const existingSessionId = scopedSessions.items[0]?.id;
    if (existingSessionId) {
      const allSessions = await client.listSessions();
      dispatch({
        type: "session_list_loaded",
        items: allSessions.items
      });
      await openSession(existingSessionId);
      return existingSessionId;
    }

    const created = await client.createSession({
      workspace_id: workspaceId,
      locale: options.uiLocale
    });
    const allSessions = await client.listSessions();
    dispatch({
      type: "session_list_loaded",
      items: allSessions.items
    });
    await openSession(created.session_id, {
      routeMode: "push",
      requestedWorkspaceId: workspaceId
    });
    return created.session_id;
  }

  async function registerWorkspace(cwd: string) {
    const payload = await client.registerWorkspace(cwd);
    const nextItems = await refreshWorkspaceList();
    const targetWorkspaceId = payload.workspace.workspace_id;
    persistWorkspaceSelection(targetWorkspaceId);

    if (!nextItems.some((item) => item.workspace_id === targetWorkspaceId)) {
      setWorkspaceList((current) => [...current, payload.workspace]);
    }

    await openOrCreateSessionForWorkspace(targetWorkspaceId);
  }

  async function pickWorkspace() {
    const t = createTranslator(options.uiLocale);
    let payload;
    try {
      payload = await client.pickWorkspace();
    } catch (error) {
      if (error instanceof MnaRequestError && error.statusCode === 404) {
        throw new Error(t("agentErrors.workspacePickerUnsupported"));
      }
      throw error;
    }

    if (payload.cancelled) {
      return null;
    }

    const nextItems = await refreshWorkspaceList();
    const targetWorkspaceId = payload.workspace.workspace_id;
    persistWorkspaceSelection(targetWorkspaceId);

    if (!nextItems.some((item) => item.workspace_id === targetWorkspaceId)) {
      setWorkspaceList((current) => [...current, payload.workspace]);
    }

    await openOrCreateSessionForWorkspace(targetWorkspaceId);
    return payload.workspace;
  }

  async function bindSessionStream(sessionId: string, initialLastEventId?: number | null) {
    const generation = streamGenerationRef.current + 1;
    streamGenerationRef.current = generation;
    streamRef.current?.close();
    streamRef.current = client.connectSessionStream(sessionId, {
      initialLastEventId,
      locale: options.uiLocale,
      onConnectionChange(connection) {
        if (streamGenerationRef.current !== generation) {
          return;
        }
        dispatch({
          type: "connection_changed",
          connection
        });
      },
      onEvent(event) {
        if (streamGenerationRef.current !== generation) {
          return;
        }
        dispatch({
          type: "server_event",
          event
        });
      },
      onError(error) {
        if (streamGenerationRef.current !== generation) {
          return;
        }
        dispatch({
          type: "bootstrap_loaded",
          bootstrapStatus: error instanceof MnaUnavailableError ? error.status : "token_invalid",
          reason: error.message
        });
      }
    });
  }

  async function openSession(
    sessionId: string,
    options: {
      routeMode?: "push" | "replace" | "none";
      requestedWorkspaceId?: string | null;
    } = {}
  ) {
    if (state.sessionId === sessionId) {
      syncAgentRoute(sessionId, options.routeMode ?? "push");
      return;
    }

    const requestedWorkspaceId =
      options.requestedWorkspaceId
      ?? state.sessionList.find((item) => item.id === sessionId)?.workspace_id
      ?? selectedWorkspaceId
      ?? state.session?.workspace_id
      ?? state.sessionList[0]?.workspace_id;
    const detail = await client.getSession(sessionId, requestedWorkspaceId);
    dispatch({
      type: "hydrate_session",
      session: detail.session,
      messages: detail.messages
    });
    syncAgentRoute(sessionId, options.routeMode ?? "push");

    const nextWorkspaceId = detail.session.workspace_id;
    const storedWorkspaceId = window.localStorage.getItem(FILE_TREE_WORKSPACE_STORAGE_KEY);
    const canReuseStoredPath = storedWorkspaceId === nextWorkspaceId;
    const storedTreePath =
      canReuseStoredPath
        ? window.localStorage.getItem(FILE_TREE_PATH_STORAGE_KEY) ?? treePath ?? "."
        : ".";
    const storedSelectedFile =
      canReuseStoredPath
        ? window.localStorage.getItem(FILE_TREE_SELECTED_FILE_STORAGE_KEY)
        : null;
    persistWorkspaceSelection(nextWorkspaceId, {
      treePath: storedTreePath,
      selectedFilePath: storedSelectedFile
    });

    await bindSessionStream(sessionId, detail.latest_event_id);
    await Promise.allSettled([
      refreshFileTree(storedTreePath, nextWorkspaceId),
      refreshMetrics(),
      refreshDependencyStatus(),
      refreshAgentConfig(),
      refreshRuntimeConfig(),
      refreshMcpState()
    ]);

    if (canReuseStoredPath && storedSelectedFile) {
      await openFile(storedSelectedFile, nextWorkspaceId).catch(() => {
        window.localStorage.removeItem(FILE_TREE_SELECTED_FILE_STORAGE_KEY);
        setSelectedFilePath(null);
        setSelectedFile(null);
      });
    }
  }

  async function createNewSession() {
    const created = await client.createSession({
      workspace_id: selectedWorkspaceId ?? undefined,
      locale: options.uiLocale
    });
    const sessions = await client.listSessions();
    dispatch({
      type: "session_list_loaded",
      items: sessions.items
    });
    await openSession(created.session_id, {
      routeMode: "push",
      requestedWorkspaceId: created.workspace_id ?? selectedWorkspaceId ?? undefined
    });
  }

  function sendInput(text: string) {
    if (state.turns.some((turn) => turn.status === "streaming")) {
      return;
    }

    const turnId = crypto.randomUUID();
    dispatch({
      type: "user_turn_submitted",
      turnId,
      text
    });
    streamRef.current?.send({
      kind: "user_input",
      turn_id: turnId,
      text
    });
  }

  function abortCurrentTurn() {
    const turnId = state.turns.findLast((turn) => turn.status === "streaming")?.turnId;
    if (!turnId) {
      return;
    }

    streamRef.current?.send({
      kind: "abort",
      turn_id: turnId
    });
  }

  function confirmTool(
    decision: "allow" | "deny" | "allow_session" | "approve" | "revise" | "cancel",
    feedback?: string
  ) {
    if (!state.pendingConfirm) {
      return;
    }

    if (state.pendingConfirm.kind === "tool") {
      if (decision !== "allow" && decision !== "deny" && decision !== "allow_session") {
        return;
      }
      if (!streamRef.current) {
        throw new Error(createTranslator(options.uiLocale)("agentErrors.websocketNotConnected"));
      }
      streamRef.current.send({
        kind: "tool_confirm",
        confirm_id: state.pendingConfirm.confirmId,
        decision
      });
    } else {
      if (decision !== "approve" && decision !== "revise" && decision !== "cancel") {
        return;
      }
      if (!streamRef.current) {
        throw new Error(createTranslator(options.uiLocale)("agentErrors.websocketNotConnected"));
      }
      streamRef.current.send({
        kind: "plan_confirm",
        confirm_id: state.pendingConfirm.confirmId,
        decision,
        ...(feedback ? { feedback } : {})
      });
    }
    dispatch({
      type: "pending_confirm_cleared"
    });
  }

  async function updateMemoryMode(memoryMode: AgentMemoryMode) {
    if (!state.sessionId) {
      return;
    }

    await client.updateMemoryMode(state.sessionId, memoryMode);
    dispatch({
      type: "session_mode_updated",
      sessionId: state.sessionId,
      memoryMode
    });
  }

  async function renameSession(sessionId: string, title: string) {
    await client.renameSession(sessionId, title);
    dispatch({
      type: "session_title_updated",
      sessionId,
      title
    });
  }

  async function deleteSession(sessionId: string) {
    await client.deleteSession(sessionId, true);
    if (window.localStorage.getItem(LAST_SESSION_ID_STORAGE_KEY) === sessionId) {
      window.localStorage.removeItem(LAST_SESSION_ID_STORAGE_KEY);
    }
    dispatch({
      type: "session_removed",
      sessionId
    });

    const sessions = await client.listSessions();
    dispatch({
      type: "session_list_loaded",
      items: sessions.items
    });

    if (state.sessionId && state.sessionId !== sessionId) {
      const activeSessionStillExists = sessions.items.some((item) => item.id === state.sessionId);
      if (activeSessionStillExists) {
        return;
      }
    }

    const nextSessionId = sessions.items[0]?.id;
    if (nextSessionId) {
      await openSession(nextSessionId);
      return;
    }

    await createNewSession();
  }

  async function updateProvider(model: string) {
    if (!state.sessionId || !dependencyStatus || !model.trim()) {
      return;
    }

    await client.updateProvider(state.sessionId, dependencyStatus.provider.id, model.trim());
    await refreshDependencyStatus();
  }

  async function updateRuntimeConfig(payload: {
    provider?: {
      kind: "not-configured" | "openai-compatible" | "openai-responses" | "anthropic" | "ollama" | "record-replay";
      model: string;
      base_url?: string;
      api_key?: string;
      api_key_env?: string;
      temperature?: number;
      effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
      max_tokens?: number | null;
      organization?: string;
      keep_alive?: string | number;
    };
    embedding?: {
      base_url?: string;
      model?: string;
      api_key?: string;
    };
    tools?: {
      approval_mode?: AgentApprovalMode;
    };
    planning?: {
      plan_mode?: AgentPlanMode;
    };
    memory_llm?: {
      base_url?: string;
      model?: string;
      api_key?: string;
      protocol?: "anthropic" | "openai-compatible" | "openai-responses" | "ollama";
      timeout_ms?: number;
      effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
      max_tokens?: number | null;
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
  }) {
    await client.updateConfig(payload);
    await Promise.allSettled([
      refreshAgentConfig(),
      refreshDependencyStatus(),
      refreshMcpState(),
    ]);
  }

  async function updateGovernanceConfig(payload: {
    WRITEBACK_MAINTENANCE_ENABLED?: boolean;
    WRITEBACK_MAINTENANCE_INTERVAL_MS?: number;
    WRITEBACK_GOVERNANCE_VERIFY_ENABLED?: boolean;
    WRITEBACK_GOVERNANCE_SHADOW_MODE?: boolean;
    WRITEBACK_MAINTENANCE_MAX_ACTIONS?: number;
  }) {
    await client.updateRuntimeConfig({ governance: payload });
    await Promise.allSettled([
      refreshRuntimeConfig(),
      refreshDependencyStatus(),
    ]);
  }

  async function listProviderModels(payload: {
    kind: "openai-compatible" | "openai-responses" | "anthropic" | "ollama";
    base_url: string;
    api_key?: string;
    api_key_env?: string;
  }) {
    return client.listProviderModels(payload);
  }

  async function checkEmbeddings() {
    const result = await client.checkEmbeddings();
    setDependencyStatus((current) => mergeDependencyProbe(current, "embeddings", result));
    await refreshDependencyStatus().catch(() => undefined);
    return result;
  }

  async function checkMemoryLlm() {
    const result = await client.checkMemoryLlm();
    setDependencyStatus((current) => mergeDependencyProbe(current, "memory_llm", result));
    await refreshDependencyStatus().catch(() => undefined);
    return result;
  }

  async function openPromptInspector(turnId: string) {
    setPromptInspectorOpen(true);
    setPromptInspector(await client.getPromptInspector(turnId));
  }

  async function restartMcpServer(name: string) {
    await client.restartMcpServer(name);
    await refreshMcpState();
  }

  async function disableMcpServer(name: string) {
    await client.disableMcpServer(name);
    await refreshMcpState();
  }

  return {
    state,
    activeTurn,
    fileTree,
    workspaceList,
    skillList,
    selectedWorkspaceId,
    selectedFilePath,
    selectedFile,
    metrics,
    dependencyStatus,
    agentConfig,
    runtimeConfig,
    mcpState,
    promptInspector,
    promptInspectorOpen,
    setPromptInspectorOpen,
    createNewSession,
    openSession,
    sendInput,
    abortCurrentTurn,
    confirmTool,
    updateMemoryMode,
    renameSession,
    deleteSession,
    updateProvider,
    updateRuntimeConfig,
    updateGovernanceConfig,
    listProviderModels,
    checkEmbeddings,
    checkMemoryLlm,
    refreshMetrics,
    refreshDependencyStatus,
    refreshAgentConfig,
    refreshRuntimeConfig,
    refreshMcpState,
    refreshWorkspaceList,
    refreshSkillList,
    registerWorkspace,
    pickWorkspace,
    selectWorkspace,
    refreshFileTree,
    openFile,
    openPromptInspector,
    restartMcpServer,
    disableMcpServer
  };
}
