export function ok<T>(data: T) {
  return {
    status: "ok" as const,
    data,
  };
}

export function accepted<T>(data: T) {
  return {
    status: "accepted_async" as const,
    data,
  };
}

export function failed(error: {
  code: string;
  message: string;
  details?: unknown;
}) {
  return {
    status: "error" as const,
    error,
  };
}
