import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_FILE = fileURLToPath(new URL("../../../.env.real-user-experience.local", import.meta.url));

function unquote(value) {
  if (value.length < 2) {
    return value;
  }
  const quote = value[0];
  if ((quote !== "\"" && quote !== "'") || value[value.length - 1] !== quote) {
    return value;
  }
  const inner = value.slice(1, -1);
  if (quote === "'") {
    return inner;
  }
  return inner
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r")
    .replaceAll("\\t", "\t")
    .replaceAll("\\\"", "\"")
    .replaceAll("\\\\", "\\");
}

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) {
    return null;
  }

  const key = match[1];
  let value = match[2].trim();
  if (!value.startsWith("\"") && !value.startsWith("'")) {
    const commentIndex = value.search(/\s+#/);
    if (commentIndex >= 0) {
      value = value.slice(0, commentIndex).trim();
    }
  }

  return [key, unquote(value)];
}

export function loadRealUserExperienceEnv() {
  const envFile = path.resolve(process.env.REAL_UX_ENV_FILE ?? DEFAULT_ENV_FILE);
  if (!existsSync(envFile)) {
    return;
  }

  const text = readFileSync(envFile, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) {
      continue;
    }
    const [key, value] = entry;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadRealUserExperienceEnv();
