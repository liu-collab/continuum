import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { axisManagedDir } from "./managed-state.js";
import { pathExists, safeJsonParse } from "./utils.js";

const PLATFORM_USER_ID_ENV_NAMES = ["PLATFORM_USER_ID", "MNA_PLATFORM_USER_ID", "MEMORY_USER_ID"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ManagedPlatformUserConfig = {
  version: 1;
  platformUserId: string;
};

type ResolvePlatformUserIdOptions = {
  configPath?: string;
};

export function axisManagedPlatformUserPath() {
  return path.join(axisManagedDir(), "platform-user.json");
}

function resolvePlatformUserIdFromEnv(env: NodeJS.ProcessEnv) {
  const value = PLATFORM_USER_ID_ENV_NAMES
    .map((name) => env[name]?.trim())
    .find((item): item is string => Boolean(item));

  if (!value) {
    return undefined;
  }

  if (!UUID_PATTERN.test(value)) {
    throw new Error("PLATFORM_USER_ID 必须是有效 UUID。");
  }

  return value;
}

async function readPersistedPlatformUserId(configPath: string) {
  if (!(await pathExists(configPath))) {
    return undefined;
  }

  const parsed = safeJsonParse<Partial<ManagedPlatformUserConfig>>(configPath, await readFile(configPath, "utf8"));
  const platformUserId = parsed.platformUserId?.trim();
  if (!platformUserId || !UUID_PATTERN.test(platformUserId)) {
    throw new Error(`本机 PLATFORM_USER_ID 配置损坏: ${configPath}，请删除该文件后重试。`);
  }
  return platformUserId;
}

export async function resolvePlatformUserId(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolvePlatformUserIdOptions = {},
) {
  const envValue = resolvePlatformUserIdFromEnv(env);
  if (envValue) {
    return envValue;
  }

  const configPath = options.configPath ?? axisManagedPlatformUserPath();
  const persistedValue = await readPersistedPlatformUserId(configPath);
  if (persistedValue) {
    return persistedValue;
  }

  const platformUserId = randomUUID();
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(
    configPath,
    JSON.stringify(
      {
        version: 1,
        platformUserId,
      } satisfies ManagedPlatformUserConfig,
      null,
      2,
    ),
    "utf8",
  );
  return platformUserId;
}
