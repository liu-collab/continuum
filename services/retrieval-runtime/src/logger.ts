import { AsyncLocalStorage } from "node:async_hooks";

import pino, { type Logger } from "pino";

import type { AppConfig } from "./config.js";

type LoggerConfig = Pick<AppConfig, "LOG_LEVEL"> & Partial<Pick<AppConfig, "LOG_SAMPLE_RATE">>;
type LogContextValue = string | number | boolean;
export type LogContextFields = Record<string, LogContextValue | undefined>;

interface LogContextState {
  fields: Record<string, LogContextValue>;
  sampling: {
    lowLevelSampled?: boolean;
  };
}

export interface CreateLoggerOptions {
  destination?: pino.DestinationStream;
  random?: () => number;
}

const WARN_LEVEL_VALUE = 40;
const logContextStorage = new AsyncLocalStorage<LogContextState>();

function normalizeLogContext(fields: LogContextFields): Record<string, LogContextValue> {
  return Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, LogContextValue] => entry[1] !== undefined),
  );
}

export function runWithLogContext<T>(fields: LogContextFields, callback: () => T): T {
  const parent = logContextStorage.getStore();
  return logContextStorage.run(
    {
      fields: {
        ...parent?.fields,
        ...normalizeLogContext(fields),
      },
      sampling: parent?.sampling ?? {},
    },
    callback,
  );
}

export function updateLogContext(fields: LogContextFields): void {
  const store = logContextStorage.getStore();
  if (!store) {
    return;
  }

  Object.assign(store.fields, normalizeLogContext(fields));
}

function shouldKeepLowerLevelLog(sampleRate: number, random: () => number) {
  const store = logContextStorage.getStore();
  if (!store) {
    return random() < sampleRate;
  }

  store.sampling.lowLevelSampled ??= random() < sampleRate;
  return store.sampling.lowLevelSampled;
}

export function createLogger(config: LoggerConfig, options: CreateLoggerOptions = {}): Logger {
  const sampleRate = config.LOG_SAMPLE_RATE ?? 1;
  const loggerOptions: pino.LoggerOptions = {
    level: config.LOG_LEVEL,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      return logContextStorage.getStore()?.fields ?? {};
    },
  };

  if (sampleRate < 1) {
    const random = options.random ?? Math.random;
    loggerOptions.hooks = {
      logMethod(args, method, level) {
        if (level >= WARN_LEVEL_VALUE || shouldKeepLowerLevelLog(sampleRate, random)) {
          method.apply(this, args);
        }
      },
    };
  }

  if (options.destination) {
    return pino(loggerOptions, options.destination);
  }

  return pino(loggerOptions);
}
