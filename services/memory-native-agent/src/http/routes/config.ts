import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { RuntimeFastifyInstance } from "../types.js";
import { updateProviderSelection } from "../state.js";

const providerKindSchema = z.enum(["demo", "openai-compatible", "anthropic", "ollama", "record-replay"]);

const providerPayloadSchema = z.object({
  kind: providerKindSchema,
  model: z.string().trim().min(1),
  base_url: z.string().trim().url().optional(),
  api_key: z.string().trim().optional(),
  api_key_env: z.string().trim().optional(),
  temperature: z.number().min(0).max(2).optional(),
  organization: z.string().trim().optional(),
  keep_alive: z.union([z.string().trim().min(1), z.number().int().min(0)]).optional(),
});

const embeddingPayloadSchema = z.object({
  base_url: z.string().trim().url().optional(),
  model: z.string().trim().min(1).optional(),
  api_key: z.string().trim().optional(),
});

const updateConfigSchema = z.object({
  provider: providerPayloadSchema.optional(),
  embedding: embeddingPayloadSchema.optional(),
});

function resolveManagedEmbeddingConfigPath(app: RuntimeFastifyInstance) {
  return process.env.CONTINUUM_EMBEDDING_CONFIG_PATH?.trim()
    || path.join(path.dirname(path.dirname(app.mnaTokenPath)), "embedding-config.json");
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

    return {
      provider: {
        kind: app.runtimeState.config.provider.kind,
        model: app.runtimeState.config.provider.model,
        base_url: app.runtimeState.config.provider.baseUrl,
        api_key: app.runtimeState.config.provider.apiKey,
        api_key_env: app.runtimeState.config.provider.apiKeyEnv,
        temperature: app.runtimeState.config.provider.temperature,
        organization: app.runtimeState.config.provider.organization,
        keep_alive: app.runtimeState.config.provider.keepAlive,
      },
      embedding: {
        base_url: embedding?.baseUrl ?? process.env.EMBEDDING_BASE_URL ?? null,
        model: embedding?.model ?? process.env.EMBEDDING_MODEL ?? null,
        api_key: embedding?.apiKey ?? process.env.EMBEDDING_API_KEY ?? null,
      },
    };
  });

  app.post("/v1/agent/config", async (request) => {
    const payload = updateConfigSchema.parse(request.body ?? {});

    if (payload.embedding) {
      await writeJson(resolveManagedEmbeddingConfigPath(app), {
        version: 1,
        ...(payload.embedding.base_url ? { baseUrl: payload.embedding.base_url } : {}),
        ...(payload.embedding.model ? { model: payload.embedding.model } : {}),
        ...(payload.embedding.api_key ? { apiKey: payload.embedding.api_key } : {}),
      });
    }

    if (payload.provider) {
      const nextProvider = {
        ...app.runtimeState.config.provider,
        kind: payload.provider.kind,
        model: payload.provider.model,
        baseUrl: payload.provider.base_url ?? app.runtimeState.config.provider.baseUrl,
        apiKey: payload.provider.api_key || undefined,
        apiKeyEnv: payload.provider.api_key_env || undefined,
        temperature: payload.provider.temperature ?? app.runtimeState.config.provider.temperature,
        organization: payload.provider.organization || undefined,
        keepAlive: payload.provider.keep_alive,
      };

      updateProviderSelection(app.runtimeState, nextProvider);
      await writeJson(resolveProviderConfigPath(app), {
        provider: {
          kind: nextProvider.kind,
          model: nextProvider.model,
          base_url: nextProvider.baseUrl,
          ...(nextProvider.apiKey ? { api_key: nextProvider.apiKey } : {}),
          ...(nextProvider.apiKeyEnv ? { api_key_env: nextProvider.apiKeyEnv } : {}),
          temperature: nextProvider.temperature,
          ...(nextProvider.organization ? { organization: nextProvider.organization } : {}),
          ...(nextProvider.keepAlive !== undefined ? { keep_alive: nextProvider.keepAlive } : {}),
        },
      });
    }

    return {
      ok: true,
    };
  });
}
