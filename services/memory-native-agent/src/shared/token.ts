import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import { MNA_HOME_DIRNAME } from "../config/defaults.js";
import { DEFAULT_TOKEN_FILENAME } from "./constants.js";

export interface TokenBootstrapResult {
  token: string;
  tokenPath: string;
}

export function resolveMnaHomeDirectory(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, MNA_HOME_DIRNAME);
}

export function resolveTokenPath(homeDirectory = os.homedir()): string {
  return path.join(resolveMnaHomeDirectory(homeDirectory), DEFAULT_TOKEN_FILENAME);
}

export function loadOrCreateToken(homeDirectory = os.homedir()): TokenBootstrapResult {
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
