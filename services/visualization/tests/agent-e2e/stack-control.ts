export function getStackControlBaseUrl() {
  const raw = process.env.PLAYWRIGHT_STACK_CONTROL_PORT;
  if (!raw) {
    throw new Error("PLAYWRIGHT_STACK_CONTROL_PORT is not set.");
  }
  return `http://127.0.0.1:${raw}`;
}

async function post(path: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(`${getStackControlBaseUrl()}${path}`, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`stack control request failed: ${path} -> ${response.status}`);
      }
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function stopRuntime() {
  await post("/runtime/stop");
}

export async function restartRuntime() {
  await post("/runtime/restart");
}

export async function stopMna() {
  await post("/mna/stop");
}

export async function restartMna() {
  await post("/mna/restart");
}

export async function triggerReplayGap(sessionId: string) {
  await post(`/agent/replay-gap?session_id=${encodeURIComponent(sessionId)}`);
}

export async function triggerSessionError(sessionId: string) {
  await post(`/agent/session-error?session_id=${encodeURIComponent(sessionId)}`);
}

async function waitForJson(path: string, predicate: (payload: Record<string, unknown>) => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastPayload: Record<string, unknown> | null = null;

  while (Date.now() < deadline) {
    const response = await fetch(`${getStackControlBaseUrl()}${path}`);
    if (response.ok) {
      lastPayload = (await response.json()) as Record<string, unknown>;
      if (predicate(lastPayload)) {
        return lastPayload;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`timed out waiting for ${path}. last payload: ${JSON.stringify(lastPayload)}`);
}

export async function waitForControlState(timeoutMs = 10_000) {
  return waitForJson(
    "/state",
    (payload) => typeof payload.mnaPort === "number" && typeof payload.runtimePort === "number",
    timeoutMs,
  );
}

export async function getLatestRunTrace() {
  const response = await fetch(`${getStackControlBaseUrl()}/runs/latest`);
  if (!response.ok) {
    throw new Error(`stack control request failed: /runs/latest -> ${response.status}`);
  }
  return (await response.json()) as {
    traceId: string | null;
    turnId: string | null;
    turns?: Array<Record<string, unknown>>;
  };
}

export async function waitForLatestRunTrace(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastPayload: Awaited<ReturnType<typeof getLatestRunTrace>> | null = null;

  while (Date.now() < deadline) {
    lastPayload = await getLatestRunTrace();
    if (lastPayload.traceId) {
      return lastPayload;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`timed out waiting for latest trace id. last payload: ${JSON.stringify(lastPayload)}`);
}
