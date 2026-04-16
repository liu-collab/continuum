import pino, { type Logger } from "pino";

import type { AppConfig } from "./config.js";

export function createLogger(config: AppConfig): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}
