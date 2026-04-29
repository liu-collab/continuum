import {
  DEFAULT_PROVIDER_FIRST_TOKEN_TIMEOUT_MS,
  DEFAULT_PROVIDER_MAX_RETRIES,
} from "../shared/constants.js";
import { MNA_VERSION } from "../shared/types.js";
import {
  ProviderAuthError,
  ProviderRateLimitedError,
  ProviderStreamError,
  ProviderTimeoutError,
  ProviderUnavailableError,
  type ProviderRuntimeSettings,
  type Usage,
} from "./types.js";

export function resolveRuntimeSettings(
  settings?: Partial<ProviderRuntimeSettings>,
  env: NodeJS.ProcessEnv = process.env,
): ProviderRuntimeSettings {
  return {
    maxRetries: settings?.maxRetries ?? Number(env.MNA_PROVIDER_MAX_RETRIES ?? DEFAULT_PROVIDER_MAX_RETRIES),
    firstTokenTimeoutMs:
      settings?.firstTokenTimeoutMs ??
      Number(env.MNA_PROVIDER_FIRST_TOKEN_TIMEOUT_MS ?? DEFAULT_PROVIDER_FIRST_TOKEN_TIMEOUT_MS),
  };
}

export function buildBaseUrl(baseUrl: string, pathname: string): URL {
  return new URL(pathname, `${baseUrl.replace(/\/+$/, "")}/`);
}

export function buildProviderUserAgent(providerId: string): string {
  return `axis-mna/${MNA_VERSION} (+provider=${providerId})`;
}

export function emptyUsage(): Usage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
  };
}

export function mergeUsage(base: Usage, override?: Partial<Usage>): Usage {
  return {
    prompt_tokens: override?.prompt_tokens ?? base.prompt_tokens,
    completion_tokens: override?.completion_tokens ?? base.completion_tokens,
  };
}

export function parseJsonObject(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProviderStreamError("Provider tool call arguments must decode to an object.");
  }

  return parsed as Record<string, unknown>;
}

export function mapStatusToError(status: number, context: string): Error {
  if (status === 401 || status === 403) {
    return new ProviderAuthError(`${context} failed with ${status}`, status);
  }
  if (status === 429) {
    return new ProviderRateLimitedError(`${context} failed with 429`, status);
  }
  if (status >= 500) {
    return new ProviderUnavailableError(`${context} failed with ${status}`, status);
  }

  return new ProviderUnavailableError(`${context} failed with ${status}`, status);
}

export function retryDelayMs(
  error: Error,
  attempt: number,
  maxRetries: number,
  retryAfterHeader?: string | null,
): number | null {
  if (error instanceof ProviderTimeoutError) {
    if (attempt >= maxRetries) {
      return null;
    }

    return attempt === 0 ? 500 : 1000;
  }

  if (error instanceof ProviderStreamError) {
    if (attempt >= maxRetries) {
      return null;
    }

    return attempt === 0 ? 500 : 1000;
  }

  if (error instanceof ProviderRateLimitedError) {
    if (attempt >= maxRetries) {
      return null;
    }

    const retryAfterSeconds = Number(retryAfterHeader ?? "1");
    return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 1000;
  }

  if (error instanceof ProviderUnavailableError) {
    if (attempt >= maxRetries) {
      return null;
    }
    return attempt === 0 ? 500 : 1000;
  }

  return null;
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new ProviderTimeoutError("Provider request aborted before retry delay completed."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function createCompositeAbortController(signal?: AbortSignal) {
  const controller = new AbortController();

  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });

  return {
    controller,
    cleanup() {
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

export function startFirstTokenTimer(controller: AbortController, timeoutMs: number): () => void {
  const timeout = setTimeout(() => {
    controller.abort("provider_first_token_timeout");
  }, timeoutMs);

  return () => {
    clearTimeout(timeout);
  };
}

export async function* streamLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        yield line.replace(/\r$/, "");
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      yield buffer.replace(/\r$/, "");
    }
  } finally {
    reader.releaseLock();
  }
}
