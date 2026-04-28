import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import {
  type ConfigFieldReaders,
  type ConfigSourceFieldMap,
  readLayeredMappedJsonConfigFields,
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
  CONTINUUM_RUNTIME_CONFIG_PATH?: string;
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
  return readOptionalConfigString(source.CONTINUUM_RUNTIME_CONFIG_PATH)
    ?? path.join(os.homedir(), ".continuum", "managed", "runtime-config.json");
}

export function resolveRuntimeGovernanceConfig(
  source: RuntimeGovernanceConfigSource,
): Partial<RuntimeGovernanceConfig> {
  return readLayeredMappedJsonConfigFields<RuntimeGovernanceConfig, RuntimeGovernanceConfigSource>(
    source,
    runtimeGovernanceConfigFieldMap,
    resolveRuntimeGovernanceConfigPath(source),
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
