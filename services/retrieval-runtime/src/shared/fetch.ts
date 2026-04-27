export interface FetchWithTimeoutInit extends RequestInit {
  timeoutMs: number;
  timeoutReason?: string;
}

export async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: FetchWithTimeoutInit,
): Promise<Response> {
  const { timeoutMs, timeoutReason = "fetch_timeout", signal, ...fetchInit } = init;

  const controller = new AbortController();
  const abortFromSignal = () => {
    controller.abort(signal?.reason ?? "fetch_aborted");
  };

  if (signal?.aborted) {
    abortFromSignal();
  } else {
    signal?.addEventListener("abort", abortFromSignal, { once: true });
  }

  const timeoutHandle = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(timeoutReason);
    }
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...fetchInit,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutHandle);
    signal?.removeEventListener("abort", abortFromSignal);
  }
}
