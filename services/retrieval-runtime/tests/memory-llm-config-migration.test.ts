import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  migrateMemoryLlmConfigFile,
  migrateMemoryLlmConfigFiles,
  migrateMemoryLlmConfigText,
  runMemoryLlmConfigMigrationCli,
} from "../src/memory-llm-config-migration.js";

describe("memory llm config migration script", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function tempFilePath(fileName = ".env") {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-llm-migration-"));
    tempDirs.push(tempDir);
    return path.join(tempDir, fileName);
  }

  function captureIo() {
    const stdout: string[] = [];
    const stderr: string[] = [];

    return {
      stdout,
      stderr,
      io: {
        stdout: { write: (chunk: string) => stdout.push(chunk) },
        stderr: { write: (chunk: string) => stderr.push(chunk) },
      },
    };
  }

  it("renames legacy writeback llm keys to memory llm keys", () => {
    const migrated = migrateMemoryLlmConfigText([
      "WRITEBACK_LLM_BASE_URL=https://api.openai.com/v1",
      "WRITEBACK_LLM_MODEL=gpt-5-mini",
      "WRITEBACK_LLM_API_KEY=test-key",
    ].join("\n"));

    expect(migrated).toContain("MEMORY_LLM_BASE_URL=https://api.openai.com/v1");
    expect(migrated).toContain("MEMORY_LLM_MODEL=gpt-5-mini");
    expect(migrated).toContain("MEMORY_LLM_API_KEY=test-key");
    expect(migrated).not.toContain("WRITEBACK_LLM_BASE_URL=");
  });

  it("keeps existing memory llm keys and drops duplicated legacy lines", () => {
    const migrated = migrateMemoryLlmConfigText([
      "MEMORY_LLM_MODEL=claude-haiku-4-5-20251001",
      "WRITEBACK_LLM_MODEL=gpt-5-mini",
      "WRITEBACK_LLM_TIMEOUT_MS=9000",
    ].join("\n"));

    expect(migrated).toContain("MEMORY_LLM_MODEL=claude-haiku-4-5-20251001");
    expect(migrated).not.toContain("WRITEBACK_LLM_MODEL=gpt-5-mini");
    expect(migrated).toContain("MEMORY_LLM_TIMEOUT_MS=9000");
  });

  it("does not emit duplicate memory llm keys when legacy keys repeat", () => {
    expect(
      migrateMemoryLlmConfigText([
        "WRITEBACK_LLM_MODEL=first-model",
        "WRITEBACK_LLM_MODEL=second-model",
      ].join("\n")),
    ).toBe("MEMORY_LLM_MODEL=first-model");
  });

  it("keeps export prefixes, comments, unrelated writeback keys, and CRLF newlines", () => {
    const migrated = migrateMemoryLlmConfigText([
      "# WRITEBACK_LLM_MODEL is documented here",
      "export WRITEBACK_LLM_BASE_URL=https://api.openai.com/v1",
      "WRITEBACK_LLM_REFINE_MAX_TOKENS=800",
      "WRITEBACK_MAX_CANDIDATES=3",
      "",
    ].join("\r\n"));

    expect(migrated).toBe([
      "# WRITEBACK_LLM_MODEL is documented here",
      "export MEMORY_LLM_BASE_URL=https://api.openai.com/v1",
      "WRITEBACK_LLM_REFINE_MAX_TOKENS=800",
      "WRITEBACK_MAX_CANDIDATES=3",
      "",
    ].join("\r\n"));
  });

  it("renames the managed config path key", () => {
    expect(migrateMemoryLlmConfigText("WRITEBACK_LLM_CONFIG_PATH=memory-llm.json")).toBe(
      "AXIS_MEMORY_LLM_CONFIG_PATH=memory-llm.json",
    );
  });

  it("migrates files in place", () => {
    const envPath = tempFilePath();
    fs.writeFileSync(envPath, "WRITEBACK_LLM_MODEL=gpt-5-mini\n", "utf8");

    expect(migrateMemoryLlmConfigFile(envPath)).toEqual({
      filePath: envPath,
      changed: true,
    });
    expect(fs.readFileSync(envPath, "utf8")).toBe("MEMORY_LLM_MODEL=gpt-5-mini\n");
  });

  it("supports dry-run file migration without writing changes", () => {
    const envPath = tempFilePath();
    fs.writeFileSync(envPath, "WRITEBACK_LLM_MODEL=gpt-5-mini\n", "utf8");

    expect(migrateMemoryLlmConfigFile(envPath, { dryRun: true })).toEqual({
      filePath: envPath,
      changed: true,
    });
    expect(fs.readFileSync(envPath, "utf8")).toBe("WRITEBACK_LLM_MODEL=gpt-5-mini\n");
  });

  it("runs the CLI in check mode without writing and returns a failing status for pending migration", () => {
    const envPath = tempFilePath();
    fs.writeFileSync(envPath, "WRITEBACK_LLM_MODEL=gpt-5-mini\n", "utf8");
    const { io, stdout, stderr } = captureIo();

    expect(runMemoryLlmConfigMigrationCli(["--check", envPath], io)).toBe(1);
    expect(stdout.join("")).toContain(`needs migration ${envPath}`);
    expect(stderr.join("")).toBe("");
    expect(fs.readFileSync(envPath, "utf8")).toBe("WRITEBACK_LLM_MODEL=gpt-5-mini\n");
  });

  it("returns a successful CLI status in check mode when files are unchanged", () => {
    const envPath = tempFilePath();
    fs.writeFileSync(envPath, "MEMORY_LLM_MODEL=gpt-5-mini\n", "utf8");
    const { io, stdout, stderr } = captureIo();

    expect(runMemoryLlmConfigMigrationCli(["--check", envPath], io)).toBe(0);
    expect(stdout.join("")).toContain(`unchanged ${envPath}`);
    expect(stderr.join("")).toBe("");
  });

  it("migrates multiple files and reports each result", () => {
    const firstEnvPath = tempFilePath("first.env");
    const secondEnvPath = tempFilePath("second.env");
    fs.writeFileSync(firstEnvPath, "WRITEBACK_LLM_BASE_URL=https://api.example.test/v1\n", "utf8");
    fs.writeFileSync(secondEnvPath, "MEMORY_LLM_MODEL=gpt-5-mini\n", "utf8");
    const { io, stdout, stderr } = captureIo();

    expect(runMemoryLlmConfigMigrationCli([firstEnvPath, secondEnvPath], io)).toBe(0);
    expect(stdout.join("")).toContain(`migrated ${firstEnvPath}`);
    expect(stdout.join("")).toContain(`unchanged ${secondEnvPath}`);
    expect(stderr.join("")).toBe("");
    expect(fs.readFileSync(firstEnvPath, "utf8")).toBe("MEMORY_LLM_BASE_URL=https://api.example.test/v1\n");
  });

  it("rolls back previously migrated files when a later write fails", () => {
    const writes: Array<{ filePath: string; data: string }> = [];
    const originals = new Map([
      ["first.env", "WRITEBACK_LLM_MODEL=first-model\n"],
      ["second.env", "WRITEBACK_LLM_MODEL=second-model\n"],
    ]);
    const fileSystem = {
      readFileSync(filePath: string) {
        const content = originals.get(filePath);
        if (content === undefined) {
          throw new Error(`missing ${filePath}`);
        }
        return content;
      },
      writeFileSync(filePath: string, data: string) {
        writes.push({ filePath, data });
        if (filePath === "second.env" && data.includes("MEMORY_LLM_MODEL")) {
          throw new Error("boom");
        }
      },
    };

    expect(() =>
      migrateMemoryLlmConfigFiles(["first.env", "second.env"], { fileSystem }),
    ).toThrow(/failed second\.env: boom/);
    expect(writes).toEqual([
      { filePath: "first.env", data: "MEMORY_LLM_MODEL=first-model\n" },
      { filePath: "second.env", data: "MEMORY_LLM_MODEL=second-model\n" },
      { filePath: "first.env", data: "WRITEBACK_LLM_MODEL=first-model\n" },
    ]);
  });

  it("rolls back in reverse order after multiple successful writes", () => {
    const writes: Array<{ filePath: string; data: string }> = [];
    const originals = new Map([
      ["first.env", "WRITEBACK_LLM_MODEL=first-model\n"],
      ["second.env", "WRITEBACK_LLM_TIMEOUT_MS=2000\n"],
      ["third.env", "WRITEBACK_LLM_BASE_URL=https://api.example.test/v1\n"],
    ]);
    const fileSystem = {
      readFileSync(filePath: string) {
        const content = originals.get(filePath);
        if (content === undefined) {
          throw new Error(`missing ${filePath}`);
        }
        return content;
      },
      writeFileSync(filePath: string, data: string) {
        writes.push({ filePath, data });
        if (filePath === "third.env" && data.includes("MEMORY_LLM_BASE_URL")) {
          throw new Error("third failed");
        }
      },
    };

    expect(() =>
      migrateMemoryLlmConfigFiles(["first.env", "second.env", "third.env"], { fileSystem }),
    ).toThrow(/failed third\.env: third failed/);
    expect(writes).toEqual([
      { filePath: "first.env", data: "MEMORY_LLM_MODEL=first-model\n" },
      { filePath: "second.env", data: "MEMORY_LLM_TIMEOUT_MS=2000\n" },
      { filePath: "third.env", data: "MEMORY_LLM_BASE_URL=https://api.example.test/v1\n" },
      { filePath: "second.env", data: "WRITEBACK_LLM_TIMEOUT_MS=2000\n" },
      { filePath: "first.env", data: "WRITEBACK_LLM_MODEL=first-model\n" },
    ]);
  });

  it("does not attempt rollback when the first write fails", () => {
    const writes: Array<{ filePath: string; data: string }> = [];
    const fileSystem = {
      readFileSync() {
        return "WRITEBACK_LLM_MODEL=first-model\n";
      },
      writeFileSync(filePath: string, data: string) {
        writes.push({ filePath, data });
        throw new Error("first failed");
      },
    };

    expect(() =>
      migrateMemoryLlmConfigFiles(["first.env"], { fileSystem }),
    ).toThrow(/failed first\.env: first failed/);
    expect(writes).toEqual([
      { filePath: "first.env", data: "MEMORY_LLM_MODEL=first-model\n" },
    ]);
  });

  it("includes rollback failures in the reported error", () => {
    const writes: Array<{ filePath: string; data: string }> = [];
    const originals = new Map([
      ["first.env", "WRITEBACK_LLM_MODEL=first-model\n"],
      ["second.env", "WRITEBACK_LLM_TIMEOUT_MS=2000\n"],
    ]);
    const fileSystem = {
      readFileSync(filePath: string) {
        const content = originals.get(filePath);
        if (content === undefined) {
          throw new Error(`missing ${filePath}`);
        }
        return content;
      },
      writeFileSync(filePath: string, data: string) {
        writes.push({ filePath, data });
        if (filePath === "second.env" && data.includes("MEMORY_LLM_TIMEOUT_MS")) {
          throw new Error("write failed");
        }
        if (filePath === "first.env" && data.includes("WRITEBACK_LLM_MODEL")) {
          throw new Error("rollback failed");
        }
      },
    };

    expect(() =>
      migrateMemoryLlmConfigFiles(["first.env", "second.env"], { fileSystem }),
    ).toThrow(/failed second\.env: write failed rollback failed: first\.env: rollback failed/);
    expect(writes).toEqual([
      { filePath: "first.env", data: "MEMORY_LLM_MODEL=first-model\n" },
      { filePath: "second.env", data: "MEMORY_LLM_TIMEOUT_MS=2000\n" },
      { filePath: "first.env", data: "WRITEBACK_LLM_MODEL=first-model\n" },
    ]);
  });

  it("prints help text from the CLI", () => {
    const { io, stdout, stderr } = captureIo();

    expect(runMemoryLlmConfigMigrationCli(["--help"], io)).toBe(0);
    expect(stdout.join("")).toContain("Usage: node scripts/migrate-memory-llm-config.mjs");
    expect(stderr.join("")).toBe("");
  });

  it("returns a failing CLI status for unknown options and missing files", () => {
    const { io, stdout, stderr } = captureIo();

    expect(runMemoryLlmConfigMigrationCli(["--unknown"], io)).toBe(1);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("unknown option: --unknown");
  });

  it("supports end-of-options marker before file paths", () => {
    const envPath = tempFilePath();
    fs.writeFileSync(envPath, "WRITEBACK_LLM_MODEL=gpt-5-mini\n", "utf8");
    const { io, stdout, stderr } = captureIo();

    expect(runMemoryLlmConfigMigrationCli(["--check", "--", envPath], io)).toBe(1);
    expect(stdout.join("")).toContain(`needs migration ${envPath}`);
    expect(stderr.join("")).toBe("");
  });

  it("returns a failing CLI status for missing files", () => {
    const { io, stdout, stderr } = captureIo();

    expect(runMemoryLlmConfigMigrationCli(["missing.env"], io)).toBe(1);
    expect(stdout.join("")).toBe("");
    expect(stderr.join("")).toContain("failed missing.env:");
  });
});
