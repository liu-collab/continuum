import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { DEFAULT_TOKEN_FILENAME } from "./constants.js";
import { resolveMnaHomeDirectory as resolveConfiguredMnaHomeDirectory } from "../config/resolver.js";

export interface TokenBootstrapResult {
  token: string;
  tokenPath: string;
}

export function resolveMnaHomeDirectory(homeDirectory?: string): string {
  if (homeDirectory) {
    return path.join(homeDirectory, ".mna");
  }

  return resolveConfiguredMnaHomeDirectory();
}

export function resolveTokenPath(homeDirectory?: string): string {
  return path.join(resolveMnaHomeDirectory(homeDirectory), DEFAULT_TOKEN_FILENAME);
}

export function resolveArtifactsRoot(homeDirectory?: string): string {
  return path.join(resolveMnaHomeDirectory(homeDirectory), "artifacts");
}

export function loadOrCreateToken(homeDirectory?: string): TokenBootstrapResult {
  const tokenPath = resolveTokenPath(homeDirectory);
  mkdirSync(path.dirname(tokenPath), { recursive: true });

  try {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (existing.length > 0) {
      return {
        token: existing,
        tokenPath,
      };
    }
  } catch {
    // create a new token below
  }

  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, token, {
    encoding: "utf8",
    mode: 0o600,
  });

  return {
    token,
    tokenPath,
  };
}
