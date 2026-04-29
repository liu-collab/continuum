import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const mappings = new Map([
  ["WRITEBACK_LLM_BASE_URL", "MEMORY_LLM_BASE_URL"],
  ["WRITEBACK_LLM_MODEL", "MEMORY_LLM_MODEL"],
  ["WRITEBACK_LLM_API_KEY", "MEMORY_LLM_API_KEY"],
  ["WRITEBACK_LLM_PROTOCOL", "MEMORY_LLM_PROTOCOL"],
  ["WRITEBACK_LLM_TIMEOUT_MS", "MEMORY_LLM_TIMEOUT_MS"],
  ["WRITEBACK_LLM_EFFORT", "MEMORY_LLM_EFFORT"],
  ["WRITEBACK_LLM_MAX_TOKENS", "MEMORY_LLM_MAX_TOKENS"],
  ["WRITEBACK_LLM_CONFIG_PATH", "AXIS_MEMORY_LLM_CONFIG_PATH"],
]);

export type MemoryLlmConfigFileMigrationResult = {
  filePath: string;
  changed: boolean;
};

type MigrateMemoryLlmConfigFileOptions = {
  dryRun?: boolean;
  fileSystem?: MemoryLlmConfigMigrationFileSystem;
};

type CliWriter = {
  write(chunk: string): unknown;
};

type MemoryLlmConfigMigrationCliIo = {
  stdout?: CliWriter;
  stderr?: CliWriter;
};

type MemoryLlmConfigMigrationFileSystem = {
  readFileSync(filePath: string, encoding: BufferEncoding): string;
  writeFileSync(filePath: string, data: string, encoding: BufferEncoding): void;
};

type MemoryLlmConfigFileMigrationSnapshot = MemoryLlmConfigFileMigrationResult & {
  original: string;
  migrated: string;
};

type MemoryLlmConfigRollbackError = {
  filePath: string;
  error: unknown;
};

class MemoryLlmConfigMigrationError extends Error {
  constructor(
    readonly filePath: string,
    readonly originalError: unknown,
    readonly rollbackErrors: readonly MemoryLlmConfigRollbackError[] = [],
  ) {
    super(buildMigrationErrorMessage(filePath, originalError, rollbackErrors));
  }
}

export function migrateMemoryLlmConfigText(input: string) {
  const newline = input.includes("\r\n") ? "\r\n" : "\n";
  const lines = input.split(/\r\n|\n/);
  const existingKeys = new Set<string>();

  for (const line of lines) {
    const parsed = parseAssignment(line);
    if (parsed) {
      existingKeys.add(parsed.key);
    }
  }

  const emittedKeys = new Set(existingKeys);
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

    if (emittedKeys.has(replacementKey)) {
      continue;
    }

    migratedLines.push(line.replace(parsed.key, replacementKey));
    emittedKeys.add(replacementKey);
  }

  return migratedLines.join(newline);
}

export function migrateMemoryLlmConfigFile(
  filePath: string,
  options: MigrateMemoryLlmConfigFileOptions = {},
): MemoryLlmConfigFileMigrationResult {
  const result = migrateMemoryLlmConfigFiles([filePath], options)[0];
  if (!result) {
    throw new Error(`missing migration result for ${filePath}`);
  }

  return result;
}

export function migrateMemoryLlmConfigFiles(
  filePaths: readonly string[],
  options: MigrateMemoryLlmConfigFileOptions = {},
): MemoryLlmConfigFileMigrationResult[] {
  const fileSystem = options.fileSystem ?? fs;
  const snapshots: MemoryLlmConfigFileMigrationSnapshot[] = [];

  for (const filePath of filePaths) {
    try {
      const original = fileSystem.readFileSync(filePath, "utf8");
      const migrated = migrateMemoryLlmConfigText(original);
      snapshots.push({
        filePath,
        changed: migrated !== original,
        original,
        migrated,
      });
    } catch (error) {
      throw new MemoryLlmConfigMigrationError(filePath, error);
    }
  }

  const results = snapshots.map(({ filePath, changed }) => ({ filePath, changed }));
  if (options.dryRun) {
    return results;
  }

  const attemptedWrites: MemoryLlmConfigFileMigrationSnapshot[] = [];
  let currentSnapshot: MemoryLlmConfigFileMigrationSnapshot | undefined;
  try {
    for (const snapshot of snapshots) {
      if (!snapshot.changed) {
        continue;
      }

      currentSnapshot = snapshot;
      fileSystem.writeFileSync(snapshot.filePath, snapshot.migrated, "utf8");
      attemptedWrites.push(snapshot);
    }
  } catch (error) {
    const failedFilePath =
      currentSnapshot?.filePath ??
      attemptedWrites.at(-1)?.filePath ??
      filePaths[0] ??
      "<unknown>";
    throw new MemoryLlmConfigMigrationError(
      failedFilePath,
      error,
      rollbackMigrations(attemptedWrites, fileSystem),
    );
  }

  return results;
}

export function runMemoryLlmConfigMigrationCli(
  argv: readonly string[] = process.argv.slice(2),
  io: MemoryLlmConfigMigrationCliIo = {},
) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const options = parseCliArgs(argv);

  if (options.help) {
    stdout.write(usage());
    return 0;
  }

  if (options.error) {
    stderr.write(`${options.error}\n\n${usage()}`);
    return 1;
  }

  if (options.files.length === 0) {
    stderr.write(usage());
    return 1;
  }

  let results: MemoryLlmConfigFileMigrationResult[];
  try {
    results = migrateMemoryLlmConfigFiles(options.files, { dryRun: options.check });
  } catch (error) {
    stderr.write(`${formatMigrationError(error)}\n`);
    return 1;
  }

  let hasChangedFile = false;
  for (const result of results) {
    hasChangedFile ||= result.changed;
    stdout.write(formatResult(result, options.check));
  }

  if (options.check && hasChangedFile) {
    return 1;
  }

  return 0;
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

function parseCliArgs(argv: readonly string[]) {
  const files: string[] = [];
  let check = false;
  let help = false;
  let error: string | undefined;
  let optionParsingEnded = false;

  for (const arg of argv) {
    if (!optionParsingEnded && arg === "--") {
      optionParsingEnded = true;
      continue;
    }

    if (!optionParsingEnded && (arg === "--help" || arg === "-h")) {
      help = true;
      continue;
    }

    if (!optionParsingEnded && arg === "--check") {
      check = true;
      continue;
    }

    if (!optionParsingEnded && arg.startsWith("-")) {
      error = `unknown option: ${arg}`;
      continue;
    }

    files.push(arg);
  }

  return { files, check, help, error };
}

function formatResult(result: MemoryLlmConfigFileMigrationResult, check: boolean) {
  if (check) {
    return `${result.changed ? "needs migration" : "unchanged"} ${result.filePath}\n`;
  }

  return `${result.changed ? "migrated" : "unchanged"} ${result.filePath}\n`;
}

function usage() {
  return [
    "Usage: node scripts/migrate-memory-llm-config.mjs [--check] <file...>",
    "",
    "Renames legacy WRITEBACK_LLM_* environment keys to MEMORY_LLM_* in place.",
    "",
    "Options:",
    "  --check  Do not write files; exit 1 when any file needs migration.",
    "  --help   Show this help.",
    "",
  ].join("\n");
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function buildMigrationErrorMessage(
  filePath: string,
  originalError: unknown,
  rollbackErrors: readonly MemoryLlmConfigRollbackError[],
) {
  const baseMessage = `failed ${filePath}: ${errorMessage(originalError)}`;
  if (rollbackErrors.length === 0) {
    return baseMessage;
  }

  return [
    baseMessage,
    "rollback failed:",
    rollbackErrors
      .map((rollbackError) => `${rollbackError.filePath}: ${errorMessage(rollbackError.error)}`)
      .join("; "),
  ].join(" ");
}

function rollbackMigrations(
  attemptedWrites: readonly MemoryLlmConfigFileMigrationSnapshot[],
  fileSystem: MemoryLlmConfigMigrationFileSystem,
) {
  const rollbackErrors: MemoryLlmConfigRollbackError[] = [];

  for (const snapshot of [...attemptedWrites].reverse()) {
    try {
      fileSystem.writeFileSync(snapshot.filePath, snapshot.original, "utf8");
    } catch (error) {
      rollbackErrors.push({ filePath: snapshot.filePath, error });
    }
  }

  return rollbackErrors;
}

function formatMigrationError(error: unknown) {
  if (!(error instanceof MemoryLlmConfigMigrationError)) {
    return errorMessage(error);
  }

  if (error.rollbackErrors.length === 0) {
    return error.message;
  }

  return error.message;
}

function isMainModule() {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  return path.resolve(entryPath) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  process.exitCode = runMemoryLlmConfigMigrationCli();
}
