const PLATFORM_USER_ID_ENV_NAMES = ["PLATFORM_USER_ID", "MNA_PLATFORM_USER_ID", "MEMORY_USER_ID"] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolvePlatformUserId(env: NodeJS.ProcessEnv = process.env) {
  const value = PLATFORM_USER_ID_ENV_NAMES
    .map((name) => env[name]?.trim())
    .find((item): item is string => Boolean(item));

  if (!value) {
    throw new Error("缺少 PLATFORM_USER_ID，请设置为有效 UUID 后再启动 visualization。");
  }

  if (!UUID_PATTERN.test(value)) {
    throw new Error("PLATFORM_USER_ID 必须是有效 UUID。");
  }

  return value;
}
