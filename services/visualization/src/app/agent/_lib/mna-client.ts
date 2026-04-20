import type { AgentTokenBootstrapResponse } from "@/lib/contracts";

import { DEFAULT_MNA_BASE_URL, toWebSocketUrl } from "./config";
import type {
  AgentMemoryMode,
  MnaApiError,
  MnaClientEvent,
  MnaCreateSessionRequest,
  MnaCreateSessionResponse,
  MnaDependencyStatusResponse,
  MnaFileResponse,
  MnaFileTreeResponse,
  MnaAgentConfigResponse,
  MnaMcpServersResponse,
  MnaMetricsResponse,
  MnaPromptInspectorResponse,
  MnaServerEventEnvelope,
  MnaSessionDetailResponse,
  MnaSessionListResponse
} from "./openapi-types";

export async function getMnaBootstrap(): Promise<AgentTokenBootstrapResponse> {
  const response = await fetch("/api/agent/token", {
    method: "GET",
    cache: "no-store"
  });

  return (await response.json()) as AgentTokenBootstrapResponse;
}

export class MnaUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: AgentTokenBootstrapResponse["status"]
  ) {
    super(message);
    this.name = "MnaUnavailableError";
  }
}

export class MnaRequestError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly code: string
  ) {
    super(message);
    this.name = "MnaRequestError";
  }
}

type BootstrapResult = AgentTokenBootstrapResponse & {
  baseUrl: string;
};

type StreamOptions = {
  onEvent(event: MnaServerEventEnvelope): void;
  onConnectionChange(state: "connecting" | "open" | "reconnecting" | "closed"): void;
  onError(error: Error): void;
  initialLastEventId?: number | null;
};

export type SessionStreamHandle = {
  send(event: MnaClientEvent): void;
  close(): void;
};

export class MnaClient {
  private bootstrapCache: BootstrapResult | null = null;

  async bootstrap(force = false): Promise<BootstrapResult> {
    if (!force && this.bootstrapCache) {
      return this.bootstrapCache;
    }

    const bootstrap = await getMnaBootstrap();
    const baseUrl = bootstrap.mnaBaseUrl ?? DEFAULT_MNA_BASE_URL;
    const result = { ...bootstrap, baseUrl };
    this.bootstrapCache = result;
    return result;
  }

  async listSessions(workspaceId?: string) {
    const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
    return this.requestJson<MnaSessionListResponse>(`/v1/agent/sessions${query}`);
  }

  async createSession(payload: MnaCreateSessionRequest) {
    return this.requestJson<MnaCreateSessionResponse>("/v1/agent/sessions", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  async getSession(sessionId: string, workspaceId?: string) {
    const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
    return this.requestJson<MnaSessionDetailResponse>(`/v1/agent/sessions/${sessionId}${query}`);
  }

  async renameSession(sessionId: string, title: string) {
    return this.requestJson<{ ok: true }>(`/v1/agent/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ title })
    });
  }

  async deleteSession(sessionId: string, purge = false) {
    const query = purge ? "?purge=all" : "";
    return this.requestJson<{ ok: true; purged: boolean }>(`/v1/agent/sessions/${sessionId}${query}`, {
      method: "DELETE"
    });
  }

  async updateMemoryMode(sessionId: string, memoryMode: AgentMemoryMode) {
    return this.requestJson<{ ok: true; memory_mode: AgentMemoryMode }>(`/v1/agent/sessions/${sessionId}/mode`, {
      method: "POST",
      body: JSON.stringify({ memory_mode: memoryMode })
    });
  }

  async updateProvider(sessionId: string, providerId: string, model: string, temperature?: number) {
    return this.requestJson<{ ok: true; provider_id: string; model: string; applies_to: string }>(
      `/v1/agent/sessions/${sessionId}/provider`,
      {
        method: "POST",
        body: JSON.stringify({
          provider_id: providerId,
          model,
          temperature
        })
      }
    );
  }

  async getPromptInspector(turnId: string) {
    return this.requestJson<MnaPromptInspectorResponse>(`/v1/agent/turns/${turnId}/dispatched-messages`);
  }

  async getFileTree(treePath = ".") {
    return this.requestJson<MnaFileTreeResponse>(`/v1/agent/fs/tree?path=${encodeURIComponent(treePath)}`);
  }

  async getFile(filePath: string) {
    return this.requestJson<MnaFileResponse>(`/v1/agent/fs/file?path=${encodeURIComponent(filePath)}`);
  }

  async getMetrics() {
    return this.requestJson<MnaMetricsResponse>("/v1/agent/metrics");
  }

  async getDependencyStatus() {
    return this.requestJson<MnaDependencyStatusResponse>("/v1/agent/dependency-status");
  }

  async getConfig() {
    return this.requestJson<MnaAgentConfigResponse>("/v1/agent/config");
  }

  async updateConfig(payload: {
    provider?: {
      kind: "demo" | "openai-compatible" | "anthropic" | "ollama" | "record-replay";
      model: string;
      base_url?: string;
      api_key?: string;
      temperature?: number;
      organization?: string;
      keep_alive?: string | number;
    };
    embedding?: {
      base_url?: string;
      model?: string;
      api_key?: string;
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
    return this.requestJson<{ ok: true }>("/v1/agent/config", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getMcpServers() {
    return this.requestJson<MnaMcpServersResponse>("/v1/agent/mcp/servers");
  }

  async restartMcpServer(name: string) {
    return this.requestJson<{ ok: true }>(`/v1/agent/mcp/servers/${encodeURIComponent(name)}/restart`, {
      method: "POST"
    });
  }

  async disableMcpServer(name: string) {
    return this.requestJson<{ ok: true }>(`/v1/agent/mcp/servers/${encodeURIComponent(name)}/disable`, {
      method: "POST"
    });
  }

  connectSessionStream(sessionId: string, options: StreamOptions): SessionStreamHandle {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retries = 0;
    let lastEventId: number | undefined = options.initialLastEventId ?? undefined;
    let heartbeat: number | null = null;
    let reconnectScheduled = false;
    const maxRetries = 5;

    const scheduleReconnect = () => {
      if (disposed) {
        options.onConnectionChange("closed");
        return;
      }
      if (reconnectScheduled) {
        return;
      }
      if (retries >= maxRetries) {
        options.onConnectionChange("closed");
        options.onError(new MnaUnavailableError("memory-native-agent 当前不可访问，请稍后重试。", "mna_not_running"));
        return;
      }

      reconnectScheduled = true;
      retries += 1;
      options.onConnectionChange("reconnecting");
      window.setTimeout(() => {
        reconnectScheduled = false;
        if (!disposed) {
          void connect(true);
        }
      }, Math.min(1500 * retries, 5000));
    };

    const clearHeartbeat = () => {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    };

    const connect = async (forceBootstrap = retries > 0) => {
      const bootstrap = await this.bootstrap(forceBootstrap);
      if (bootstrap.status !== "ok" || !bootstrap.token) {
        throw new MnaUnavailableError(bootstrap.reason ?? "memory-native-agent 不可用。", bootstrap.status);
      }

      options.onConnectionChange(retries > 0 ? "reconnecting" : "connecting");
      socket = new WebSocket(toWebSocketUrl(bootstrap.baseUrl, sessionId, bootstrap.token, lastEventId));

      socket.addEventListener("open", () => {
        retries = 0;
        reconnectScheduled = false;
        options.onConnectionChange("open");
        clearHeartbeat();
        heartbeat = window.setInterval(() => {
          socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ kind: "ping" }));
        }, 15000);
      });

      socket.addEventListener("message", (message) => {
        const payload = JSON.parse(String(message.data)) as MnaServerEventEnvelope;
        if (typeof payload.event_id === "number") {
          lastEventId = payload.event_id;
        }
        options.onEvent(payload);
      });

      socket.addEventListener("close", () => {
        clearHeartbeat();
        socket = null;
        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        clearHeartbeat();
        socket = null;
        scheduleReconnect();
      });
    };

    void connect().catch((error) => {
      options.onError(error instanceof Error ? error : new Error(String(error)));
      scheduleReconnect();
    });

    return {
      send(event) {
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          throw new Error("session websocket is not connected");
        }
        socket.send(JSON.stringify(event));
      },
      close() {
        disposed = true;
        clearHeartbeat();
        socket?.close();
        socket = null;
        options.onConnectionChange("closed");
      }
    };
  }

  private async requestJson<T>(pathname: string, init?: RequestInit, retryOnUnauthorized = true): Promise<T> {
    const bootstrap = await this.bootstrap();
    if (bootstrap.status !== "ok" || !bootstrap.token) {
      throw new MnaUnavailableError(bootstrap.reason ?? "memory-native-agent 不可用。", bootstrap.status);
    }

    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${bootstrap.token}`);
    if (init?.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await fetch(`${bootstrap.baseUrl}${pathname}`, {
        ...init,
        cache: "no-store",
        headers
      });
    } catch (error) {
      this.bootstrapCache = null;
      throw new MnaUnavailableError(
        error instanceof Error ? error.message : "memory-native-agent 当前不可访问，请稍后重试。",
        "mna_not_running"
      );
    }

    if (response.status === 401 && retryOnUnauthorized) {
      await this.bootstrap(true);
      return this.requestJson<T>(pathname, init, false);
    }

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as MnaApiError | null;
      throw new MnaRequestError(
        payload?.error?.message ?? `Request failed with status ${response.status}.`,
        response.status,
        payload?.error?.code ?? "request_failed"
      );
    }

    return (await response.json()) as T;
  }
}
