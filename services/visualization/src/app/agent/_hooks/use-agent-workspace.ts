"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { initialAgentState, reduceAgentEvent } from "../_lib/event-reducer";
import type { AgentLocale, AgentMemoryMode, MnaPromptInspectorResponse } from "../_lib/openapi-types";
import { MnaUnavailableError } from "../_lib/mna-client";
import { useAgentClient } from "./use-agent-client";

type UseAgentWorkspaceOptions = {
  sessionId?: string;
  uiLocale: AgentLocale;
};

export function useAgentWorkspace(options: UseAgentWorkspaceOptions) {
  const router = useRouter();
  const pathname = usePathname();
  const client = useAgentClient();
  const [state, dispatch] = useReducer(reduceAgentEvent, initialAgentState);
  const [treePath, setTreePath] = useState(".");
  const [fileTree, setFileTree] = useState<{ path: string; entries: Array<{ name: string; type: "directory" | "file" | "other" }> }>({
    path: ".",
    entries: []
  });
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string } | null>(null);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof client.getMetrics>> | null>(null);
  const [dependencyStatus, setDependencyStatus] = useState<Awaited<ReturnType<typeof client.getDependencyStatus>> | null>(null);
  const [mcpState, setMcpState] = useState<Awaited<ReturnType<typeof client.getMcpServers>> | null>(null);
  const [promptInspector, setPromptInspector] = useState<MnaPromptInspectorResponse | null>(null);
  const [promptInspectorOpen, setPromptInspectorOpen] = useState(false);
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const streamRef = useRef<ReturnType<typeof client.connectSessionStream> | null>(null);
  const streamGenerationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

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

      const sessionList = await client.listSessions();
      if (cancelled) {
        return;
      }

      dispatch({
        type: "session_list_loaded",
        items: sessionList.items
      });

      if (options.sessionId) {
        await openSession(options.sessionId);
        return;
      }

      const existingSessionId = sessionList.items[0]?.id;
      if (existingSessionId) {
        router.replace(`/agent/${existingSessionId}`);
        return;
      }

      const created = await client.createSession({
        locale: options.uiLocale
      });
      if (cancelled) {
        return;
      }

      router.replace(`/agent/${created.session_id}`);
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
      streamGenerationRef.current += 1;
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, [bootstrapAttempt, client, options.sessionId, router]);

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

  async function refreshMcpState() {
    setMcpState(await client.getMcpServers());
  }

  async function refreshFileTree(nextPath = treePath) {
    const payload = await client.getFileTree(nextPath);
    setTreePath(payload.path);
    setFileTree(payload);
  }

  async function openFile(filePath: string) {
    const payload = await client.getFile(filePath);
    setSelectedFile(payload);
  }

  async function bindSessionStream(sessionId: string, initialLastEventId?: number | null) {
    const generation = streamGenerationRef.current + 1;
    streamGenerationRef.current = generation;
    streamRef.current?.close();
    streamRef.current = client.connectSessionStream(sessionId, {
      initialLastEventId,
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

  async function openSession(sessionId: string) {
    const targetPath = `/agent/${sessionId}`;
    if (pathname !== targetPath) {
      router.push(targetPath);
      return;
    }

    const detail = await client.getSession(sessionId);
    dispatch({
      type: "hydrate_session",
      session: detail.session,
      messages: detail.messages
    });

    await bindSessionStream(sessionId, detail.latest_event_id);
    await Promise.allSettled([refreshFileTree("."), refreshMetrics(), refreshDependencyStatus(), refreshMcpState()]);
  }

  async function createNewSession() {
    const created = await client.createSession({
      locale: options.uiLocale
    });
    router.push(`/agent/${created.session_id}`);
  }

  function sendInput(text: string) {
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
    const turnId = activeTurn?.turnId;
    if (!turnId) {
      return;
    }

    streamRef.current?.send({
      kind: "abort",
      turn_id: turnId
    });
  }

  function confirmTool(decision: "allow" | "deny" | "allow_session") {
    if (!state.pendingConfirm) {
      return;
    }

    streamRef.current?.send({
      kind: "tool_confirm",
      confirm_id: state.pendingConfirm.confirmId,
      decision
    });
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
    selectedFile,
    metrics,
    dependencyStatus,
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
    refreshMetrics,
    refreshDependencyStatus,
    refreshMcpState,
    refreshFileTree,
    openFile,
    openPromptInspector,
    restartMcpServer,
    disableMcpServer
  };
}
