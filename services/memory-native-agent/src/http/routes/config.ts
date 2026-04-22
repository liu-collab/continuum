import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { RuntimeFastifyInstance } from "../types.js";
import { updateMcpServers, updatePlanMode, updateProviderSelection, updateToolApprovalMode } from "../state.js";

const providerKindSchema = z.enum(["demo", "openai-compatible", "anthropic", "ollama", "record-replay"]);
const mcpServerPayloadSchema = z.object({
  name: z.string().trim().min(1),
  transport: z.enum(["stdio", "http"]),
  command: z.string().trim().min(1).optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().trim().url().optional(),
  headers: z.record(z.string()).optional(),
  cwd: z.string().trim().min(1).optional(),
  startup_timeout_ms: z.number().int().min(100).max(120_000).optional(),
  request_timeout_ms: z.number().int().min(100).max(120_000).optional(),
  reconnect_on_failure: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.transport === "stdio" && !value.command) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["command"],
      message: "command is required for stdio transport.",
    });
  }

  if (value.transport === "http" && !value.url) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["url"],
      message: "url is required for http transport.",
    });
  }
});

const providerPayloadSchema = z.object({
  kind: providerKindSchema,
  model: z.string().trim().min(1),
  base_url: z.string().trim().url().optional(),
  api_key: z.string().trim().optional(),
  temperature: z.number().min(0).max(2).optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).nullable().optional(),
  max_tokens: z.number().int().min(1).nullable().optional(),
  organization: z.string().trim().optional(),
  keep_alive: z.union([z.string().trim().min(1), z.number().int().min(0)]).optional(),
}).superRefine((value, context) => {
  const requiresBaseUrl =
    value.kind === "openai-compatible" || value.kind === "anthropic" || value.kind === "ollama";
  const requiresApiKey = value.kind === "openai-compatible" || value.kind === "anthropic";

  if (requiresBaseUrl && !value.base_url) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["base_url"],
      message: "base_url is required for the selected provider.",
    });
  }

  if (requiresApiKey && !value.api_key) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["api_key"],
      message: "api_key is required for the selected provider.",
    });
  }
});

const embeddingPayloadSchema = z.object({
  base_url: z.string().trim().url().optional(),
  model: z.string().trim().min(1).optional(),
  api_key: z.string().trim().optional(),
});

const writebackLlmPayloadSchema = z.object({
  base_url: z.string().trim().url().optional(),
  model: z.string().trim().min(1).optional(),
  api_key: z.string().trim().optional(),
  protocol: z.enum(["anthropic", "openai-compatible"]).optional(),
  timeout_ms: z.number().int().min(100).max(120_000).optional(),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).nullable().optional(),
  max_tokens: z.number().int().min(1).nullable().optional(),
});

const updateConfigSchema = z.object({
  provider: providerPayloadSchema.optional(),
  embedding: embeddingPayloadSchema.optional(),
  writeback_llm: writebackLlmPayloadSchema.optional(),
  tools: z.object({
    approval_mode: z.enum(["confirm", "yolo"]).optional(),
  }).optional(),
  planning: z.object({
    plan_mode: z.enum(["advisory", "confirm"]).optional(),
  }).optional(),
  mcp: z.object({
    servers: z.array(mcpServerPayloadSchema),
  }).optional(),
});

function formatZodIssues(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("; ");
}

function resolveManagedEmbeddingConfigPath(app: RuntimeFastifyInstance) {
  return process.env.CONTINUUM_EMBEDDING_CONFIG_PATH?.trim()
    || path.join(path.dirname(path.dirname(app.mnaTokenPath)), "embedding-config.json");
}

function resolveManagedWritebackLlmConfigPath(app: RuntimeFastifyInstance) {
  return process.env.CONTINUUM_WRITEBACK_LLM_CONFIG_PATH?.trim()
    || path.join(path.dirname(path.dirname(app.mnaTokenPath)), "writeback-llm-config.json");
}

function resolveProviderConfigPath(app: RuntimeFastifyInstance) {
  return path.join(path.dirname(app.mnaTokenPath), "config.json");
}

async function writeJson(filePath: string, payload: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export function registerConfigRoutes(app: RuntimeFastifyInstance) {
  app.get("/v1/agent/config", async () => {
    const embedding = await readJson<{
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    }>(resolveManagedEmbeddingConfigPath(app));
    const writebackLlm = await readJson<{
      baseUrl?: string;
      model?: string;
      apiKey?: string;
      protocol?: "anthropic" | "openai-compatible";
      timeoutMs?: number;
      effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
      maxTokens?: number | null;
    }>(resolveManagedWritebackLlmConfigPath(app));

    return {
      provider: {
        kind: app.runtimeState.config.provider.kind,
        model: app.runtimeState.config.provider.model,
        base_url: app.runtimeState.config.provider.baseUrl,
        api_key: app.runtimeState.config.provider.apiKey,
        temperature: app.runtimeState.config.provider.temperature,
        effort: app.runtimeState.config.provider.effort ?? null,
        max_tokens: app.runtimeState.config.provider.maxTokens ?? null,
        organization: app.runtimeState.config.provider.organization,
        keep_alive: app.runtimeState.config.provider.keepAlive,
      },
      tools: {
        approval_mode: app.runtimeState.config.tools.approvalMode,
      },
      planning: {
        plan_mode: app.runtimeState.config.planning.planMode,
      },
      embedding: {
        base_url: embedding?.baseUrl ?? process.env.EMBEDDING_BASE_URL ?? null,
        model: embedding?.model ?? process.env.EMBEDDING_MODEL ?? null,
        api_key: embedding?.apiKey ?? process.env.EMBEDDING_API_KEY ?? null,
      },
      writeback_llm: {
        base_url: writebackLlm?.baseUrl ?? process.env.WRITEBACK_LLM_BASE_URL ?? null,
        model: writebackLlm?.model ?? process.env.WRITEBACK_LLM_MODEL ?? "claude-haiku-4-5-20251001",
        api_key: writebackLlm?.apiKey ?? process.env.WRITEBACK_LLM_API_KEY ?? null,
        protocol:
          writebackLlm?.protocol
          ?? ((process.env.WRITEBACK_LLM_PROTOCOL as "anthropic" | "openai-compatible" | undefined)
            ?? "openai-compatible"),
        timeout_ms: writebackLlm?.timeoutMs ?? (
          process.env.WRITEBACK_LLM_TIMEOUT_MS?.trim()
            ? Number(process.env.WRITEBACK_LLM_TIMEOUT_MS)
            : 5000
        ),
        effort: writebackLlm?.effort ?? null,
        max_tokens: writebackLlm?.maxTokens ?? null,
      },
      mcp: {
        servers: app.runtimeState.config.mcp.servers,
      },
    };
  });

  app.post("/v1/agent/config", async (request, reply) => {
    const parsed = updateConfigSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({
        ok: false,
        error: {
          code: "invalid_config_payload",
          message: formatZodIssues(parsed.error),
        },
      });
    }
    const payload = parsed.data;

    if (payload.embedding) {
      await writeJson(resolveManagedEmbeddingConfigPath(app), {
        version: 1,
        ...(payload.embedding.base_url ? { baseUrl: payload.embedding.base_url } : {}),
        ...(payload.embedding.model ? { model: payload.embedding.model } : {}),
        ...(payload.embedding.api_key ? { apiKey: payload.embedding.api_key } : {}),
      });
    }

    if (payload.writeback_llm) {
      await writeJson(resolveManagedWritebackLlmConfigPath(app), {
        version: 1,
        ...(payload.writeback_llm.base_url ? { baseUrl: payload.writeback_llm.base_url } : {}),
        ...(payload.writeback_llm.model ? { model: payload.writeback_llm.model } : {}),
        ...(payload.writeback_llm.api_key ? { apiKey: payload.writeback_llm.api_key } : {}),
        ...(payload.writeback_llm.protocol ? { protocol: payload.writeback_llm.protocol } : {}),
        ...(payload.writeback_llm.timeout_ms ? { timeoutMs: payload.writeback_llm.timeout_ms } : {}),
        ...(payload.writeback_llm.effort !== undefined ? { effort: payload.writeback_llm.effort } : {}),
        ...(payload.writeback_llm.max_tokens !== undefined ? { maxTokens: payload.writeback_llm.max_tokens } : {}),
      });
    }

    if (payload.provider) {
      const nextProvider = {
        ...app.runtimeState.config.provider,
        kind: payload.provider.kind,
        model: payload.provider.model,
        baseUrl: payload.provider.base_url ?? app.runtimeState.config.provider.baseUrl,
        apiKey: payload.provider.api_key || undefined,
        apiKeyEnv: undefined,
        temperature: payload.provider.temperature ?? app.runtimeState.config.provider.temperature,
        effort: payload.provider.effort !== undefined
          ? payload.provider.effort
          : app.runtimeState.config.provider.effort,
        maxTokens: payload.provider.max_tokens !== undefined
          ? payload.provider.max_tokens
          : app.runtimeState.config.provider.maxTokens,
        organization: payload.provider.organization || undefined,
        keepAlive: payload.provider.keep_alive,
      };

      updateProviderSelection(app.runtimeState, nextProvider);
      const existingConfig = (await readJson<Record<string, unknown>>(resolveProviderConfigPath(app))) ?? {};
      await writeJson(resolveProviderConfigPath(app), {
        ...existingConfig,
        provider: {
          kind: nextProvider.kind,
          model: nextProvider.model,
          base_url: nextProvider.baseUrl,
          ...(nextProvider.apiKey ? { api_key: nextProvider.apiKey } : {}),
          temperature: nextProvider.temperature,
          effort: nextProvider.effort ?? null,
          max_tokens: nextProvider.maxTokens ?? null,
          ...(nextProvider.organization ? { organization: nextProvider.organization } : {}),
          ...(nextProvider.keepAlive !== undefined ? { keep_alive: nextProvider.keepAlive } : {}),
        },
      });
    }

    if (payload.tools?.approval_mode) {
      updateToolApprovalMode(app.runtimeState, payload.tools.approval_mode);

      const existingConfig = (await readJson<Record<string, unknown>>(resolveProviderConfigPath(app))) ?? {};
      await writeJson(resolveProviderConfigPath(app), {
        ...existingConfig,
        tools: {
          ...(isRecord(existingConfig.tools) ? existingConfig.tools : {}),
          approval_mode: payload.tools.approval_mode,
        },
      });
    }

    if (payload.planning?.plan_mode) {
      updatePlanMode(app.runtimeState, payload.planning.plan_mode);

      const existingConfig = (await readJson<Record<string, unknown>>(resolveProviderConfigPath(app))) ?? {};
      await writeJson(resolveProviderConfigPath(app), {
        ...existingConfig,
        planning: {
          ...(isRecord(existingConfig.planning) ? existingConfig.planning : {}),
          plan_mode: payload.planning.plan_mode,
        },
      });
    }

    if (payload.mcp) {
      const nextServers = payload.mcp.servers.map((server) => ({
        name: server.name,
        transport: server.transport,
        command: server.command,
        args: server.args,
        env: server.env,
        url: server.url,
        headers: server.headers,
        cwd: server.cwd,
        startup_timeout_ms: server.startup_timeout_ms,
        request_timeout_ms: server.request_timeout_ms,
        reconnect_on_failure: server.reconnect_on_failure,
      }));

      await updateMcpServers(app.runtimeState, nextServers);

      const existingConfig = (await readJson<Record<string, unknown>>(resolveProviderConfigPath(app))) ?? {};
      await writeJson(resolveProviderConfigPath(app), {
        ...existingConfig,
        mcp: {
          servers: nextServers,
        },
      });
    }

    return {
      ok: true,
    };
  });

  app.post("/v1/agent/dependency-status/embeddings/check", async () => {
    return app.runtimeState.memoryClient.checkEmbeddings();
  });

  app.post("/v1/agent/dependency-status/writeback-llm/check", async () => {
    return app.runtimeState.memoryClient.checkWritebackLlm();
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
