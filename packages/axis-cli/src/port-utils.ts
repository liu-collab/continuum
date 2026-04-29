import { createServer } from "node:net";

import { DEFAULT_MANAGED_POSTGRES_PORT } from "./managed-state.js";

export const LOOPBACK_BIND_HOST = "127.0.0.1";
export const WILDCARD_BIND_HOST = "0.0.0.0";
export const POSTGRES_PORT_SCAN_LIMIT = 20;
export const DEFAULT_UI_DEV_PORT = 3003;
export const UI_DEV_PORT_SCAN_LIMIT = 20;

export function parsePort(rawValue: string | boolean | undefined, optionName: string) {
  if (typeof rawValue !== "string") {
    throw new Error(`不支持的 ${optionName}: ${rawValue}`);
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(`不支持的 ${optionName}: ${rawValue}`);
  }

  return parsed;
}

export function normalizeBindHost(rawValue: string | boolean | undefined) {
  const bindHost = typeof rawValue === "string" ? rawValue : LOOPBACK_BIND_HOST;

  if (bindHost !== LOOPBACK_BIND_HOST && bindHost !== WILDCARD_BIND_HOST) {
    throw new Error(
      `不支持的 --bind-host: ${bindHost}。当前仅支持 ${LOOPBACK_BIND_HOST} 或 ${WILDCARD_BIND_HOST}。`,
    );
  }

  return bindHost;
}

export function resolveAccessibleHost(bindHost: string) {
  return bindHost === WILDCARD_BIND_HOST ? LOOPBACK_BIND_HOST : bindHost;
}

export async function isTcpPortAvailable(host: string, port: number) {
  return await new Promise<boolean>((resolve) => {
    const server = createServer();

    server.once("error", () => {
      server.close(() => resolve(false));
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen({
      host,
      port,
      exclusive: true,
    });
  });
}

export async function waitForTcpAvailable(host: string, port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const available = await isTcpPortAvailable(host, port);
    if (available) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `visualization dev 端口仍被占用: ${host}:${port}。旧的 --ui-dev 进程可能没有退出，请先运行 npm run stop，或手动结束占用 3003 的进程后重试。`,
  );
}

export async function resolveUiDevPort(host: string, preferredPort = DEFAULT_UI_DEV_PORT) {
  for (let offset = 0; offset <= UI_DEV_PORT_SCAN_LIMIT; offset += 1) {
    const candidate = preferredPort + offset;
    if (await isTcpPortAvailable(host, candidate)) {
      if (candidate !== preferredPort) {
        process.stdout.write(`默认 visualization dev 端口 ${preferredPort} 不可用，自动切换到 ${candidate}。\n`);
      }

      return candidate;
    }
  }

  throw new Error(
    `未找到可用的 visualization dev 端口。已尝试 ${host}:${preferredPort}-${preferredPort + UI_DEV_PORT_SCAN_LIMIT}。`,
  );
}

export async function resolveManagedPostgresPort(
  options: Record<string, string | boolean>,
  bindHost: string,
  probePort: (host: string, port: number) => Promise<boolean> = isTcpPortAvailable,
) {
  const requestedPort =
    typeof options["postgres-port"] === "string"
      ? Number(options["postgres-port"])
      : DEFAULT_MANAGED_POSTGRES_PORT;
  const explicitPort = typeof options["postgres-port"] === "string";

  if (!Number.isInteger(requestedPort) || requestedPort <= 0 || requestedPort > 65_535) {
    throw new Error(`不支持的 --postgres-port: ${options["postgres-port"]}`);
  }

  if (explicitPort) {
    if (!(await probePort(bindHost, requestedPort))) {
      throw new Error(`postgres 端口不可用: ${bindHost}:${requestedPort}。请改用其他 --postgres-port。`);
    }

    return requestedPort;
  }

  for (let offset = 0; offset <= POSTGRES_PORT_SCAN_LIMIT; offset += 1) {
    const candidate = requestedPort + offset;
    if (!(await probePort(bindHost, candidate))) {
      continue;
    }

    if (candidate !== requestedPort) {
      process.stdout.write(
        `默认 postgres 端口 ${requestedPort} 不可用，自动切换到 ${candidate}。\n`,
      );
    }

    return candidate;
  }

  throw new Error(
    `未找到可用的 postgres 端口。已尝试 ${bindHost}:${requestedPort}-${requestedPort + POSTGRES_PORT_SCAN_LIMIT}。`,
  );
}
