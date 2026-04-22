const mappings = new Map([
  ["WRITEBACK_LLM_BASE_URL", "MEMORY_LLM_BASE_URL"],
  ["WRITEBACK_LLM_MODEL", "MEMORY_LLM_MODEL"],
  ["WRITEBACK_LLM_API_KEY", "MEMORY_LLM_API_KEY"],
  ["WRITEBACK_LLM_PROTOCOL", "MEMORY_LLM_PROTOCOL"],
  ["WRITEBACK_LLM_TIMEOUT_MS", "MEMORY_LLM_TIMEOUT_MS"],
  ["WRITEBACK_LLM_EFFORT", "MEMORY_LLM_EFFORT"],
  ["WRITEBACK_LLM_MAX_TOKENS", "MEMORY_LLM_MAX_TOKENS"],
  ["WRITEBACK_LLM_CONFIG_PATH", "CONTINUUM_MEMORY_LLM_CONFIG_PATH"],
]);

export function migrateMemoryLlmConfigText(input: string) {
  const lines = input.split(/\r?\n/);
  const existingKeys = new Set<string>();

  for (const line of lines) {
    const parsed = parseAssignment(line);
    if (parsed) {
      existingKeys.add(parsed.key);
    }
  }

  const migratedLines: string[] = [];
  for (const line of lines) {
    const parsed = parseAssignment(line);
    if (!parsed) {
      migratedLines.push(line);
      continue;
    }

    const replacementKey = mappings.get(parsed.key);
    if (!replacementKey) {
      migratedLines.push(line);
      continue;
    }

    if (existingKeys.has(replacementKey)) {
      continue;
    }

    migratedLines.push(line.replace(parsed.key, replacementKey));
  }

  return migratedLines.join("\n");
}

function parseAssignment(line: string) {
  const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/);
  if (!match?.[1]) {
    return null;
  }

  return {
    key: match[1],
  };
}
