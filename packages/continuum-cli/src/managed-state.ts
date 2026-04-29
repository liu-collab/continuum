import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { pathExists } from "./utils.js";

export type ManagedServiceRecord = {
  name: string;
  pid: number;
  logPath: string;
  url?: string;
  tokenPath?: string;
  artifactsPath?: string;
  version?: string;
};

export type ContinuumManagedState = {
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
export const DEFAULT_MANAGED_STACK_CONTAINER = "continuum-stack";
export const DEFAULT_MANAGED_STACK_IMAGE = "continuum-local:latest";
export const DEFAULT_MANAGED_LEGACY_POSTGRES_CONTAINER = "continuum-postgres";
export const DEFAULT_MANAGED_DATABASE_NAME = "continuum";
export const DEFAULT_MANAGED_DATABASE_USER = "continuum";

const PROCESS_MANAGED_DATABASE_PASSWORD = randomBytes(12).toString("hex");

export function continuumHomeDir() {
  return path.join(os.homedir(), ".continuum");
}

export function continuumLogsDir() {
  return path.join(continuumHomeDir(), "logs");
}

export function continuumManagedDir() {
  return path.join(continuumHomeDir(), "managed");
}

export function continuumStatePath() {
  return path.join(continuumHomeDir(), "state.json");
}

export function resolveDatabasePasswordFromState(state: Pick<ContinuumManagedState, "dbPassword">) {
  return state.dbPassword ?? process.env.CONTINUUM_DB_PASSWORD ?? PROCESS_MANAGED_DATABASE_PASSWORD;
}

export function buildManagedDatabaseUrl(port: number, password: string) {
  return `postgres://${DEFAULT_MANAGED_DATABASE_USER}:${password}@127.0.0.1:${port}/${DEFAULT_MANAGED_DATABASE_NAME}`;
}

export async function readManagedState(): Promise<ContinuumManagedState> {
  if (!(await pathExists(continuumStatePath()))) {
    return {
      version: 1,
      services: [],
    };
  }

  return JSON.parse(await readFile(continuumStatePath(), "utf8")) as ContinuumManagedState;
}

export async function writeManagedState(state: ContinuumManagedState) {
  await mkdir(path.dirname(continuumStatePath()), { recursive: true });
  await writeFile(continuumStatePath(), JSON.stringify(state, null, 2), "utf8");
}
