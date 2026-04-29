import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { pathExists, safeJsonParse } from "./utils.js";

export type ManagedServiceRecord = {
  name: string;
  pid: number;
  logPath: string;
  url?: string;
  tokenPath?: string;
  artifactsPath?: string;
  version?: string;
};

export type AxisManagedState = {
  version: 1;
  dbPassword?: string;
  postgres?: {
    containerName: string;
    port: number;
    database: string;
    username: string;
  };
  services: ManagedServiceRecord[];
};

export const DEFAULT_MANAGED_POSTGRES_PORT = 54329;
export const DEFAULT_MANAGED_STACK_CONTAINER = "axis-stack";
export const DEFAULT_MANAGED_STACK_IMAGE = "axis-stack:latest";
export const DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER = "axis-postgres";
export const DEFAULT_MANAGED_DATABASE_NAME = "axis_db";
export const DEFAULT_MANAGED_DATABASE_USER = "axis_user";

const PROCESS_MANAGED_DATABASE_PASSWORD = randomBytes(12).toString("hex");

export function axisHomeDir() {
  return path.join(os.homedir(), ".axis");
}

export function axisLogsDir() {
  return path.join(axisHomeDir(), "logs");
}

export function axisManagedDir() {
  return path.join(axisHomeDir(), "managed");
}

export function axisStatePath() {
  return path.join(axisHomeDir(), "state.json");
}

export function resolveDatabasePasswordFromState(state: Pick<AxisManagedState, "dbPassword">) {
  return state.dbPassword ?? process.env.AXIS_DB_PASSWORD ?? PROCESS_MANAGED_DATABASE_PASSWORD;
}

export function buildManagedDatabaseUrl(port: number, password: string) {
  return `postgres://${DEFAULT_MANAGED_DATABASE_USER}:${password}@127.0.0.1:${port}/${DEFAULT_MANAGED_DATABASE_NAME}`;
}

export async function readManagedState(): Promise<AxisManagedState> {
  if (!(await pathExists(axisStatePath()))) {
    return {
      version: 1,
      services: [],
    };
  }

  const filePath = axisStatePath();
  return safeJsonParse<AxisManagedState>(filePath, await readFile(filePath, "utf8"));
}

export async function writeManagedState(state: AxisManagedState) {
  const statePath = axisStatePath();
  const tempPath = `${statePath}.tmp`;
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
  await rename(tempPath, statePath);
}
