import { createServer } from "node:net";

import { DEFAULT_MANAGED_POSTGRES_PORT } from "./managed-state.js";
import { bilingualMessage } from "./messages.js";

export const LOOPBACK_BIND_HOST = "127.0.0.1";
export const WILDCARD_BIND_HOST = "0.0.0.0";
export const POSTGRES_PORT_SCAN_LIMIT = 20;
export const DEFAULT_STORAGE_PORT = 3001;
export const DEFAULT_RUNTIME_PORT = 3002;
export const DEFAULT_VISUALIZATION_PORT = 3003;
export const DEFAULT_UI_DEV_PORT = 3003;
export const UI_DEV_PORT_SCAN_LIMIT = 20;

export function parsePort(rawValue: string | boolean | undefined, optionName: string) {
  if (typeof rawValue !== "string") {
    throw new Error(bilingualMessage(
      `不支持的 ${optionName}: ${rawValue}`,
      `Unsupported ${optionName}: ${rawValue}`,
    ));
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65_535) {
    throw new Error(bilingualMessage(
      `不支持的 ${optionName}: ${rawValue}`,
      `Unsupported ${optionName}: ${rawValue}`,
    ));
  }

  return parsed;
}

export function parsePortEnv(rawValue: string | undefined, envName: string, defaultPort: number) {
  if (rawValue === undefined || rawValue.trim() === "") {
    return defaultPort;
  }

  return parsePort(rawValue, envName);
}

export function normalizeBindHost(rawValue: string | boolean | undefined) {
  const bindHost = typeof rawValue === "string" ? rawValue : LOOPBACK_BIND_HOST;

  if (bindHost !== LOOPBACK_BIND_HOST && bindHost !== WILDCARD_BIND_HOST) {
    throw new Error(
      bilingualMessage(
        `不支持的 --bind-host: ${bindHost}。当前仅支持 ${LOOPBACK_BIND_HOST} 或 ${WILDCARD_BIND_HOST}。`,
        `Unsupported --bind-host: ${bindHost}. Only ${LOOPBACK_BIND_HOST} or ${WILDCARD_BIND_HOST} is supported.`,
      ),
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
    bilingualMessage(
      `visualization dev 端口仍被占用: ${host}:${port}。旧的 --ui-dev 进程可能没有退出，请先运行 npm run stop，或手动结束占用 3003 的进程后重试。`,
      `Visualization dev port is still in use: ${host}:${port}. A previous --ui-dev process may still be running. Run npm run stop or end the process using port 3003 and retry.`,
    ),
  );
}

export async function resolveUiDevPort(host: string, preferredPort = DEFAULT_UI_DEV_PORT) {
  for (let offset = 0; offset <= UI_DEV_PORT_SCAN_LIMIT; offset += 1) {
    const candidate = preferredPort + offset;
    if (await isTcpPortAvailable(host, candidate)) {
      if (candidate !== preferredPort) {
        process.stdout.write(
          `- ${bilingualMessage(
            `默认 visualization dev 端口 ${preferredPort} 不可用，自动切换到 ${candidate}。`,
            `Default visualization dev port ${preferredPort} is unavailable, switched to ${candidate}.`,
          )}\n`,
        );
      }

      return candidate;
    }
  }

  throw new Error(
    bilingualMessage(
      `未找到可用的 visualization dev 端口。已尝试 ${host}:${preferredPort}-${preferredPort + UI_DEV_PORT_SCAN_LIMIT}。`,
      `No available visualization dev port was found. Tried ${host}:${preferredPort}-${preferredPort + UI_DEV_PORT_SCAN_LIMIT}.`,
    ),
  );
}

export async function resolveAvailableTcpPort(
  input: {
    host: string;
    preferredPort: number;
    scanLimit: number;
    label: string;
    excludedPorts?: number[];
  },
  probePort: (host: string, port: number) => Promise<boolean> = isTcpPortAvailable,
) {
  const excludedPorts = new Set(input.excludedPorts ?? []);

  for (let offset = 0; offset <= input.scanLimit; offset += 1) {
    const candidate = input.preferredPort + offset;
    if (excludedPorts.has(candidate)) {
      continue;
    }

    if (!(await probePort(input.host, candidate))) {
      continue;
    }

    if (candidate !== input.preferredPort) {
      process.stdout.write(
        `- ${bilingualMessage(
          `默认 ${input.label} 端口 ${input.preferredPort} 不可用，自动切换到 ${candidate}。`,
          `Default ${input.label} port ${input.preferredPort} is unavailable, switched to ${candidate}.`,
        )}\n`,
      );
    }

    return candidate;
  }

  throw new Error(
    bilingualMessage(
      `未找到可用的 ${input.label} 端口。已尝试 ${input.host}:${input.preferredPort}-${input.preferredPort + input.scanLimit}。`,
      `No available ${input.label} port was found. Tried ${input.host}:${input.preferredPort}-${input.preferredPort + input.scanLimit}.`,
    ),
  );
}

export async function assertFixedServicePortsAvailable(
  host: string,
  ports: Array<{ port: number; envName: string }>,
  probePort: (host: string, port: number) => Promise<boolean> = isTcpPortAvailable,
) {
  for (const item of ports) {
    if (!(await probePort(host, item.port))) {
      throw new Error(bilingualMessage(
        `端口 ${item.port} 已被占用，请先释放该端口或设置 ${item.envName} 环境变量（不是 CLI flag）。`,
        `Port ${item.port} is already in use. Free it first or set the ${item.envName} environment variable (not a CLI flag).`,
      ));
    }
  }
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
    throw new Error(bilingualMessage(
      `不支持的 --postgres-port: ${options["postgres-port"]}`,
      `Unsupported --postgres-port: ${options["postgres-port"]}`,
    ));
  }

  if (explicitPort) {
    if (!(await probePort(bindHost, requestedPort))) {
      throw new Error(bilingualMessage(
        `postgres 端口不可用: ${bindHost}:${requestedPort}。请改用其他 --postgres-port。`,
        `Postgres port is unavailable: ${bindHost}:${requestedPort}. Use a different --postgres-port.`,
      ));
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
        `- ${bilingualMessage(
          `默认 postgres 端口 ${requestedPort} 不可用，自动切换到 ${candidate}。`,
          `Default postgres port ${requestedPort} is unavailable, switched to ${candidate}.`,
        )}\n`,
      );
    }

    return candidate;
  }

  throw new Error(
    bilingualMessage(
      `未找到可用的 postgres 端口。已尝试 ${bindHost}:${requestedPort}-${requestedPort + POSTGRES_PORT_SCAN_LIMIT}。`,
      `No available postgres port was found. Tried ${bindHost}:${requestedPort}-${requestedPort + POSTGRES_PORT_SCAN_LIMIT}.`,
    ),
  );
}
