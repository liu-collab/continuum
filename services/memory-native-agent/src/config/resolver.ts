import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import {
  IDENTITY_FILENAME,
  MNA_HOME_DIRNAME,
  WORKSPACE_MAP_FILENAME,
  WORKSPACE_NAMESPACE_UUID,
} from "./defaults.js";
import type { Locale } from "./schema.js";

function ensureMnaHome(homeDirectory: string): string {
  const mnaHome = path.join(homeDirectory, MNA_HOME_DIRNAME);
  mkdirSync(mnaHome, { recursive: true });
  return mnaHome;
}

function normalizeDriveLetter(value: string): string {
  return value.replace(/^[a-z]:/, (match) => match.toUpperCase());
}

function trimTrailingSlash(value: string): string {
  if (value === "/") {
    return value;
  }

  if (/^[A-Z]:\/$/.test(value)) {
    return value;
  }

  return value.replace(/\/+$/, "");
}

function uuidStringToBytes(value: string): Uint8Array {
  const hex = value.replace(/-/g, "");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createUuidV5(namespace: string, name: string): string {
  const namespaceBytes = uuidStringToBytes(namespace);
  const hash = createHash("sha1");
  hash.update(namespaceBytes);
  hash.update(name, "utf8");

  const bytes = Uint8Array.from(hash.digest().subarray(0, 16));
  const versionByte = bytes[6];
  const variantByte = bytes[8];
  if (versionByte === undefined || variantByte === undefined) {
    throw new Error("Failed to derive UUIDv5 bytes.");
  }

  bytes[6] = (versionByte & 0x0f) | 0x50;
  bytes[8] = (variantByte & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

export function resolveHomeDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const homeDirectory = env.HOME ?? env.USERPROFILE;
  if (!homeDirectory) {
    throw new Error("Cannot resolve home directory from HOME or USERPROFILE.");
  }

  return path.resolve(homeDirectory);
}

export function normalizeWorkspacePath(cwd: string): string {
  const resolved = path.resolve(cwd);
  const real = realpathSync.native(resolved);
  const slashed = normalizeDriveLetter(real.replace(/\\/g, "/"));
  return trimTrailingSlash(slashed);
}

export function deriveWorkspaceId(cwd: string): string {
  return createUuidV5(WORKSPACE_NAMESPACE_UUID, normalizeWorkspacePath(cwd));
}

export function resolveUserId(configuredUserId: string | null, homeDirectory: string): string {
  if (configuredUserId) {
    return configuredUserId;
  }

  const identityPath = path.join(ensureMnaHome(homeDirectory), IDENTITY_FILENAME);
  try {
    const parsed = JSON.parse(readFileSync(identityPath, "utf8")) as { user_id?: string };
    if (typeof parsed.user_id === "string" && parsed.user_id.length > 0) {
      return parsed.user_id;
    }
  } catch {
    // fall through to create a new identity
  }

  const userId = randomUUID();
  writeFileSync(identityPath, JSON.stringify({ user_id: userId }, null, 2), "utf8");
  return userId;
}

export function persistWorkspaceMapping(homeDirectory: string, cwd: string, workspaceId: string): void {
  const mappingPath = path.join(ensureMnaHome(homeDirectory), WORKSPACE_MAP_FILENAME);
  let currentMappings: Record<string, string> = {};

  try {
    currentMappings = JSON.parse(readFileSync(mappingPath, "utf8")) as Record<string, string>;
  } catch {
    currentMappings = {};
  }

  currentMappings[cwd] = workspaceId;
  writeFileSync(mappingPath, JSON.stringify(currentMappings, null, 2), "utf8");
}

function normalizeLocale(value: string | undefined): Locale | undefined {
  if (!value) {
    return undefined;
  }

  const lowered = value.toLowerCase();
  if (lowered.startsWith("zh")) {
    return "zh-CN";
  }
  if (lowered.startsWith("en")) {
    return "en-US";
  }
  return undefined;
}

export function resolveLocale(configuredLocale: Locale | undefined, env: NodeJS.ProcessEnv = process.env): Locale {
  const envLocale = normalizeLocale(env.MNA_LOCALE);
  const systemLocale = normalizeLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  return configuredLocale ?? envLocale ?? systemLocale ?? "zh-CN";
}
