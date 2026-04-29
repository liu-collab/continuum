import { Client } from "pg";

import {
  DEFAULT_RUNTIME_URL,
  DEFAULT_STORAGE_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_UI_URL,
  fetchJson,
} from "./utils.js";
import {
  buildManagedDatabaseUrl,
  readManagedState,
  resolveDatabasePasswordFromState,
} from "./managed-state.js";
import { bilingualMessage } from "./messages.js";
import { getManagedMnaStatus } from "./mna-command.js";

type StatusCheckResult = {
  name: string;
  status: "healthy" | "degraded" | "unavailable" | "unknown";
  detail: string;
};

function formatLine(result: StatusCheckResult) {
  return `${result.name.padEnd(18)} ${result.status.padEnd(12)} ${result.detail}`;
}

async function checkRuntime(runtimeUrl: string, timeoutMs: number): Promise<StatusCheckResult> {
  const response = await fetchJson(`${runtimeUrl}/healthz`, timeoutMs);
  if (!response.ok) {
    return {
      name: "retrieval-runtime",
      status: "unavailable",
      detail: response.error ?? `http_${response.status ?? "unknown"}`,
    };
  }

  const body = response.body as {
    liveness?: string;
    readiness?: string;
  };

  return {
    name: "retrieval-runtime",
    status:
      (body?.liveness === "healthy" || body?.liveness === "alive") &&
      (body?.readiness === "healthy" || body?.readiness === "ready")
        ? "healthy"
        : "degraded",
    detail: `liveness=${body?.liveness ?? "unknown"} readiness=${body?.readiness ?? "unknown"}`,
  };
}

async function checkStorage(storageUrl: string, timeoutMs: number): Promise<StatusCheckResult> {
  const response = await fetchJson(`${storageUrl}/health`, timeoutMs);
  if (!response.ok) {
    return {
      name: "storage",
      status: "unavailable",
      detail: response.error ?? `http_${response.status ?? "unknown"}`,
    };
  }

  const envelope = response.body as {
    data?: {
      liveness?: string;
      readiness?: string;
      reason?: string | null;
    };
  };

  const liveness = envelope?.data?.liveness ?? "unknown";
  const readiness = envelope?.data?.readiness ?? "unknown";

  return {
    name: "storage",
    status:
      (liveness === "healthy" || liveness === "alive") &&
      (readiness === "healthy" || readiness === "ready")
        ? "healthy"
        : "degraded",
    detail: `liveness=${liveness} readiness=${readiness}${envelope?.data?.reason ? ` reason=${envelope.data.reason}` : ""}`,
  };
}

async function checkUi(uiUrl: string, timeoutMs: number): Promise<StatusCheckResult> {
  const response = await fetchJson(`${uiUrl}/api/health/readiness`, timeoutMs);
  if (!response.ok) {
    return {
      name: "visualization",
      status: "unavailable",
      detail: response.error ?? `http_${response.status ?? "unknown"}`,
    };
  }

  const body = response.body as {
    status?: string;
    summary?: string;
  };

  return {
    name: "visualization",
    status: body?.status === "healthy" || body?.status === "ready" ? "healthy" : "degraded",
    detail: body?.summary ?? `status=${body?.status ?? "unknown"}`,
  };
}

async function checkDatabase(
  databaseUrl: string | undefined,
  timeoutMs: number,
): Promise<StatusCheckResult> {
  if (!databaseUrl) {
    return {
      name: "database",
      status: "unknown",
      detail: "database url not provided",
    };
  }

  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: timeoutMs,
  });

  try {
    await client.connect();
    await client.query("select 1 as ok");
    return {
      name: "database",
      status: "healthy",
      detail: "connected",
    };
  } catch (error) {
    return {
      name: "database",
      status: "unavailable",
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function runStatusCommand(options: Record<string, string | boolean>) {
  const runtimeUrl =
    typeof options["runtime-url"] === "string" ? options["runtime-url"] : DEFAULT_RUNTIME_URL;
  const storageUrl =
    typeof options["storage-url"] === "string" ? options["storage-url"] : DEFAULT_STORAGE_URL;
  const uiUrl = typeof options["ui-url"] === "string" ? options["ui-url"] : DEFAULT_UI_URL;
  const managedState = await readManagedState();
  const managedDatabaseUrl = managedState.postgres
    ? buildManagedDatabaseUrl(
        managedState.postgres.port,
        resolveDatabasePasswordFromState(managedState),
      )
    : undefined;
  const databaseUrl =
    typeof options["database-url"] === "string"
      ? options["database-url"]
      : managedDatabaseUrl ?? process.env.DATABASE_URL;
  const timeoutMs =
    typeof options.timeout === "string" ? Number(options.timeout) : DEFAULT_TIMEOUT_MS;
  const strict = options.strict === true;
  const json = options.json === true;

  const mnaStatus = await getManagedMnaStatus(options);
  const results = await Promise.all([
    checkStorage(storageUrl, timeoutMs),
    checkRuntime(runtimeUrl, timeoutMs),
    checkUi(uiUrl, timeoutMs),
    checkDatabase(databaseUrl, timeoutMs),
  ]);
  const mnaAuthorized = mnaStatus.health.ok && mnaStatus.dependency.ok && mnaStatus.dependency.status !== 401;
  const mnaResult: StatusCheckResult = mnaAuthorized
    ? {
        name: "memory-native-agent",
        status: "healthy",
        detail: `${mnaStatus.url} token=${mnaStatus.tokenPath}`,
      }
    : {
        name: "memory-native-agent",
        status: mnaStatus.record ? "degraded" : "unavailable",
        detail:
          mnaStatus.dependency.status === 401
            ? bilingualMessage(
                "axis 与正在运行的 memory-native-agent token 不匹配。运行 axis mna token 获取最新 token。",
                "Token mismatch between axis and the running memory-native-agent. Run axis mna token to get the latest token.",
              )
            : mnaStatus.health.error
              ?? mnaStatus.dependency.error
              ?? bilingualMessage(
                `http_${mnaStatus.health.status ?? "unknown"}`,
                `http_${mnaStatus.health.status ?? "unknown"}`,
              ),
      };
  const allResults = [...results, mnaResult];

  const hasFailure = allResults.some((result) => result.status === "unavailable");
  const hasDegraded = allResults.some((result) => result.status === "degraded");
  const exitCode = hasFailure || (strict && hasDegraded) ? 1 : 0;

  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          status: exitCode === 0 ? "ok" : "failed",
          checks: allResults,
          mna: {
            url: mnaStatus.url,
            tokenPath: mnaStatus.tokenPath,
            logPath: mnaStatus.logPath,
            artifactsPath: mnaStatus.artifactsPath,
            dependency: mnaStatus.dependency.body ?? null,
          },
        },
        null,
        2,
      )}\n`,
    );
    return exitCode;
  }

  process.stdout.write("Axis status\n");
  for (const result of allResults) {
    process.stdout.write(`${formatLine(result)}\n`);
  }
  process.stdout.write(`mna token path      ${mnaStatus.tokenPath}\n`);
  process.stdout.write(`mna log path        ${mnaStatus.logPath}\n`);
  process.stdout.write(`mna artifacts path  ${mnaStatus.artifactsPath}\n`);

  return exitCode;
}
