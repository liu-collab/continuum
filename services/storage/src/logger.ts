import pino from "pino";

export function createLogger(level: string) {
  return pino({
    level,
    base: {
      service: "storage",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
