import fs from "node:fs";

import { ConfigurationError } from "./errors.js";

export type JsonConfigObject = Record<string, unknown>;
export type ConfigFieldReader<T> = (value: unknown) => T | undefined;
export type ConfigFieldReaders<T extends object> = {
  [K in keyof T]-?: ConfigFieldReader<T[K]>;
};
export type ConfigSourceFieldMap<T extends object, Source extends object> = {
  [K in keyof T]-?: keyof Source;
};

export function readOptionalConfigString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readOptionalConfigBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  const configValue = readOptionalConfigString(value);
  if (!configValue) {
    return undefined;
  }

  const normalized = configValue.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

export function readOptionalConfigPositiveInteger(value: unknown): number | undefined {
  const numericValue = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
      ? Number(value)
      : undefined;

  if (typeof numericValue !== "number" || !Number.isFinite(numericValue) || numericValue <= 0) {
    return undefined;
  }

  const integerValue = Math.trunc(numericValue);
  return integerValue > 0 ? integerValue : undefined;
}

export function normalizeHttpConfigUrl(value: unknown): string | undefined {
  const rawValue = readOptionalConfigString(value);
  if (!rawValue) {
    return undefined;
  }

  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }

    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

type RuntimeLocalhostMappingSource = {
  AXIS_RUNTIME_CONTAINER?: unknown;
  AXIS_RUNTIME_LOCALHOST_HOST?: unknown;
};

export function rewriteLoopbackHttpConfigUrl(
  value: unknown,
  replacementHost: unknown,
): string | undefined {
  const normalized = normalizeHttpConfigUrl(value);
  const host = readOptionalConfigString(replacementHost);
  if (!normalized || !host) {
    return normalized;
  }

  const parsed = new URL(normalized);
  const hostname = parsed.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    return normalized;
  }

  parsed.hostname = host;
  return parsed.toString().replace(/\/+$/, "");
}

export function mapLoopbackHttpConfigUrlForRuntime(
  value: unknown,
  source: RuntimeLocalhostMappingSource,
): string | undefined {
  const normalized = normalizeHttpConfigUrl(value);
  if (!normalized) {
    return undefined;
  }

  const runtimeContainer = readOptionalConfigBoolean(source.AXIS_RUNTIME_CONTAINER) ?? false;
  if (!runtimeContainer) {
    return normalized;
  }

  return rewriteLoopbackHttpConfigUrl(
    normalized,
    source.AXIS_RUNTIME_LOCALHOST_HOST ?? "host.docker.internal",
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function readRequiredJsonConfigFile<T extends JsonConfigObject>(
  filePath: unknown,
  configName = "JSON",
): T {
  const normalizedPath = readOptionalConfigString(filePath);
  if (!normalizedPath) {
    throw new ConfigurationError(`${configName} config path must be a non-empty string`);
  }

  let rawConfig: string;
  try {
    rawConfig = fs.readFileSync(normalizedPath, "utf8");
  } catch (error) {
    throw new ConfigurationError(`Failed to read ${configName} config file`, {
      path: normalizedPath,
      reason: errorMessage(error),
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawConfig);
  } catch (error) {
    throw new ConfigurationError(`Failed to parse ${configName} config file`, {
      path: normalizedPath,
      reason: errorMessage(error),
    });
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ConfigurationError(`${configName} config file must contain a JSON object`, {
      path: normalizedPath,
    });
  }

  return payload as T;
}

export function readJsonConfigFile<T extends JsonConfigObject>(filePath: unknown): T | undefined {
  const normalizedPath = readOptionalConfigString(filePath);
  if (!normalizedPath) {
    return undefined;
  }

  try {
    return readRequiredJsonConfigFile<T>(normalizedPath);
  } catch {
    return undefined;
  }
}

export function readConfigFields<T extends object>(
  payload: JsonConfigObject | undefined,
  readers: ConfigFieldReaders<T>,
): Partial<T> {
  if (!payload) {
    return {};
  }

  const entries: Array<[string, unknown]> = [];
  const typedReaders = readers as Record<string, ConfigFieldReader<unknown>>;
  for (const [field, readValue] of Object.entries(typedReaders)) {
    const value = readValue(payload[field]);
    if (value !== undefined) {
      entries.push([field, value]);
    }
  }

  return Object.fromEntries(entries) as Partial<T>;
}

export function readLayeredConfigFields<T extends object>(
  payloads: Array<JsonConfigObject | undefined>,
  readers: ConfigFieldReaders<T>,
): Partial<T> {
  return Object.assign(
    {},
    ...payloads.map((payload) => readConfigFields<T>(payload, readers)),
  );
}

export function readLayeredJsonConfigFields<T extends object>(
  payloads: Array<JsonConfigObject | undefined>,
  filePath: unknown,
  readers: ConfigFieldReaders<T>,
): Partial<T> {
  return readLayeredConfigFields(
    [...payloads, readJsonConfigFile(filePath)],
    readers,
  );
}

export function readJsonConfigFields<T extends object>(
  filePath: unknown,
  readers: ConfigFieldReaders<T>,
): Partial<T> {
  return readConfigFields(readJsonConfigFile(filePath), readers);
}

export function mapConfigSourceFields<T extends object, Source extends object>(
  source: Source,
  fieldMap: ConfigSourceFieldMap<T, Source>,
): JsonConfigObject {
  const entries: Array<[string, unknown]> = [];

  for (const [targetField, sourceField] of Object.entries(fieldMap)) {
    entries.push([targetField, source[sourceField as keyof Source]]);
  }

  return Object.fromEntries(entries);
}

export function readLayeredMappedJsonConfigFields<T extends object, Source extends object>(
  source: Source,
  fieldMap: ConfigSourceFieldMap<T, Source>,
  filePath: unknown,
  readers: ConfigFieldReaders<T>,
): Partial<T> {
  return readLayeredJsonConfigFields(
    [mapConfigSourceFields<T, Source>(source, fieldMap)],
    filePath,
    readers,
  );
}

export function readLayeredMappedJsonConfigFieldsFromSource<
  T extends object,
  Source extends object,
>(
  source: Source,
  fieldMap: ConfigSourceFieldMap<T, Source>,
  configPathField: keyof Source,
  readers: ConfigFieldReaders<T>,
): Partial<T> {
  return readLayeredMappedJsonConfigFields<T, Source>(
    source,
    fieldMap,
    source[configPathField],
    readers,
  );
}
