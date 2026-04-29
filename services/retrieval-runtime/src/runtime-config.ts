import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import {
  type ConfigFieldReaders,
  type ConfigSourceFieldMap,
  mapConfigSourceFields,
  readJsonConfigFile,
  readLayeredConfigFields,
  readOptionalConfigBoolean,
  readOptionalConfigPositiveInteger,
  readOptionalConfigString,
} from "./config-file.js";

export type RuntimeGovernanceConfig = {
  WRITEBACK_MAINTENANCE_ENABLED: boolean;
  WRITEBACK_MAINTENANCE_INTERVAL_MS: number;
  WRITEBACK_GOVERNANCE_VERIFY_ENABLED: boolean;
  WRITEBACK_GOVERNANCE_SHADOW_MODE: boolean;
  WRITEBACK_MAINTENANCE_MAX_ACTIONS: number;
};

export type RuntimeGovernanceConfigSource = Partial<RuntimeGovernanceConfig> & {
  AXIS_RUNTIME_CONFIG_PATH?: string;
  AXIS_MANAGED_CONFIG_PATH?: string;
};

export const runtimeGovernanceConfigUpdateSchema = z.object({
  WRITEBACK_MAINTENANCE_ENABLED: z.boolean().optional(),
  WRITEBACK_MAINTENANCE_INTERVAL_MS: z.number().int().min(30_000).optional(),
  WRITEBACK_GOVERNANCE_VERIFY_ENABLED: z.boolean().optional(),
  WRITEBACK_GOVERNANCE_SHADOW_MODE: z.boolean().optional(),
  WRITEBACK_MAINTENANCE_MAX_ACTIONS: z.number().int().min(1).max(20).optional(),
}).strict();

export type RuntimeGovernanceConfigUpdate = z.infer<typeof runtimeGovernanceConfigUpdateSchema>;

const runtimeGovernanceConfigReaders: ConfigFieldReaders<RuntimeGovernanceConfig> = {
  WRITEBACK_MAINTENANCE_ENABLED: readOptionalConfigBoolean,
  WRITEBACK_MAINTENANCE_INTERVAL_MS: readOptionalConfigPositiveInteger,
  WRITEBACK_GOVERNANCE_VERIFY_ENABLED: readOptionalConfigBoolean,
  WRITEBACK_GOVERNANCE_SHADOW_MODE: readOptionalConfigBoolean,
  WRITEBACK_MAINTENANCE_MAX_ACTIONS: readOptionalConfigPositiveInteger,
};

const runtimeGovernanceConfigFieldMap: ConfigSourceFieldMap<
  RuntimeGovernanceConfig,
  RuntimeGovernanceConfigSource
> = {
  WRITEBACK_MAINTENANCE_ENABLED: "WRITEBACK_MAINTENANCE_ENABLED",
  WRITEBACK_MAINTENANCE_INTERVAL_MS: "WRITEBACK_MAINTENANCE_INTERVAL_MS",
  WRITEBACK_GOVERNANCE_VERIFY_ENABLED: "WRITEBACK_GOVERNANCE_VERIFY_ENABLED",
  WRITEBACK_GOVERNANCE_SHADOW_MODE: "WRITEBACK_GOVERNANCE_SHADOW_MODE",
  WRITEBACK_MAINTENANCE_MAX_ACTIONS: "WRITEBACK_MAINTENANCE_MAX_ACTIONS",
};

export function resolveRuntimeGovernanceConfigPath(
  source: RuntimeGovernanceConfigSource = process.env as RuntimeGovernanceConfigSource,
) {
  return readOptionalConfigString(source.AXIS_RUNTIME_CONFIG_PATH)
    ?? path.join(os.homedir(), ".axis", "managed", "runtime-config.json");
}

export function resolveManagedRuntimeConfigPath(
  source: RuntimeGovernanceConfigSource = process.env as RuntimeGovernanceConfigSource,
) {
  return readOptionalConfigString(source.AXIS_MANAGED_CONFIG_PATH)
    ?? path.join(os.homedir(), ".axis", "managed", "config.json");
}

function readUnifiedGovernanceConfig(source: RuntimeGovernanceConfigSource) {
  return readJsonConfigFile<{
    governance?: Partial<RuntimeGovernanceConfig>;
  }>(resolveManagedRuntimeConfigPath(source))?.governance;
}

export function resolveRuntimeGovernanceConfig(
  source: RuntimeGovernanceConfigSource,
): Partial<RuntimeGovernanceConfig> {
  return readLayeredConfigFields<RuntimeGovernanceConfig>(
    [
      mapConfigSourceFields<RuntimeGovernanceConfig, RuntimeGovernanceConfigSource>(
        source,
        runtimeGovernanceConfigFieldMap,
      ),
      readJsonConfigFile(resolveRuntimeGovernanceConfigPath(source)),
      readUnifiedGovernanceConfig(source),
    ],
    runtimeGovernanceConfigReaders,
  );
}

export function pickRuntimeGovernanceConfig(source: RuntimeGovernanceConfig): RuntimeGovernanceConfig {
  return {
    WRITEBACK_MAINTENANCE_ENABLED: source.WRITEBACK_MAINTENANCE_ENABLED,
    WRITEBACK_MAINTENANCE_INTERVAL_MS: source.WRITEBACK_MAINTENANCE_INTERVAL_MS,
    WRITEBACK_GOVERNANCE_VERIFY_ENABLED: source.WRITEBACK_GOVERNANCE_VERIFY_ENABLED,
    WRITEBACK_GOVERNANCE_SHADOW_MODE: source.WRITEBACK_GOVERNANCE_SHADOW_MODE,
    WRITEBACK_MAINTENANCE_MAX_ACTIONS: source.WRITEBACK_MAINTENANCE_MAX_ACTIONS,
  };
}

export async function writeRuntimeGovernanceConfigFile(
  filePath: string,
  config: RuntimeGovernanceConfig,
) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify({ version: 1, ...config }, null, 2),
    "utf8",
  );
}

export async function writeManagedRuntimeGovernanceConfigFile(
  filePath: string,
  config: RuntimeGovernanceConfig,
) {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    JSON.stringify({ ...payload, version: 2, governance: config }, null, 2),
    "utf8",
  );
}
