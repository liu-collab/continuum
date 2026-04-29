import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  mapConfigSourceFields,
  normalizeHttpConfigUrl,
  readConfigFields,
  readJsonConfigFields,
  readJsonConfigFile,
  readLayeredConfigFields,
  readLayeredJsonConfigFields,
  readLayeredMappedJsonConfigFields,
  readOptionalConfigBoolean,
  readOptionalConfigPositiveInteger,
  readOptionalConfigString,
  readRequiredJsonConfigFile,
} from "../src/config-file.js";
import { ConfigurationError } from "../src/errors.js";
import {
  resolveRuntimeGovernanceConfig,
  writeRuntimeGovernanceConfigFile,
} from "../src/runtime-config.js";

describe("config file helper", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function tempConfigPath(fileName = "config.json") {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "retrieval-config-"));
    tempDirs.push(tempDir);
    return path.join(tempDir, fileName);
  }

  it("reads an existing JSON object config file", () => {
    const configPath = tempConfigPath();
    fs.writeFileSync(configPath, JSON.stringify({ baseUrl: "https://example.test", retries: 3 }), "utf8");

    expect(readJsonConfigFile<{ baseUrl: string; retries: number }>(configPath)).toEqual({
      baseUrl: "https://example.test",
      retries: 3,
    });
  });

  it("reads a required JSON object config file", () => {
    const configPath = tempConfigPath();
    fs.writeFileSync(configPath, JSON.stringify({ model: "test-model" }), "utf8");

    expect(readRequiredJsonConfigFile<{ model: string }>(configPath, "test")).toEqual({
      model: "test-model",
    });
  });

  it("trims config paths before reading files", () => {
    const configPath = tempConfigPath();
    fs.writeFileSync(configPath, JSON.stringify({ model: "test-model" }), "utf8");

    expect(readJsonConfigFile<{ model: string }>(`  ${configPath}  `)).toEqual({
      model: "test-model",
    });
  });

  it("returns undefined when the config path is absent or missing", () => {
    const configPath = tempConfigPath("missing.json");

    expect(readJsonConfigFile(undefined)).toBeUndefined();
    expect(readJsonConfigFile(configPath)).toBeUndefined();
  });

  it("returns undefined for invalid or non-object JSON", () => {
    const invalidConfigPath = tempConfigPath("invalid.json");
    fs.writeFileSync(invalidConfigPath, "{ nope", "utf8");

    const arrayConfigPath = tempConfigPath("array.json");
    fs.writeFileSync(arrayConfigPath, JSON.stringify(["not", "a", "config"]), "utf8");

    const nullConfigPath = tempConfigPath("null.json");
    fs.writeFileSync(nullConfigPath, "null", "utf8");

    expect(readJsonConfigFile(invalidConfigPath)).toBeUndefined();
    expect(readJsonConfigFile(arrayConfigPath)).toBeUndefined();
    expect(readJsonConfigFile(nullConfigPath)).toBeUndefined();
  });

  it("throws configuration errors for required config file failures", () => {
    const missingConfigPath = tempConfigPath("missing.json");

    expect(() => readRequiredJsonConfigFile(undefined, "test")).toThrow(ConfigurationError);
    expect(() => readRequiredJsonConfigFile(missingConfigPath, "test")).toThrow(
      "Failed to read test config file",
    );

    const invalidConfigPath = tempConfigPath("required-invalid.json");
    fs.writeFileSync(invalidConfigPath, "{ nope", "utf8");

    const arrayConfigPath = tempConfigPath("required-array.json");
    fs.writeFileSync(arrayConfigPath, JSON.stringify(["not", "a", "config"]), "utf8");

    expect(() => readRequiredJsonConfigFile(invalidConfigPath, "test")).toThrow(
      "Failed to parse test config file",
    );
    expect(() => readRequiredJsonConfigFile(arrayConfigPath, "test")).toThrow(
      "test config file must contain a JSON object",
    );
  });

  it("normalizes optional config strings", () => {
    expect(readOptionalConfigString("  value  ")).toBe("value");
    expect(readOptionalConfigString("  ")).toBeUndefined();
    expect(readOptionalConfigString(undefined)).toBeUndefined();
    expect(readOptionalConfigString(42)).toBeUndefined();
  });

  it("normalizes optional boolean config values", () => {
    expect(readOptionalConfigBoolean(true)).toBe(true);
    expect(readOptionalConfigBoolean(false)).toBe(false);
    expect(readOptionalConfigBoolean(" true ")).toBe(true);
    expect(readOptionalConfigBoolean("YES")).toBe(true);
    expect(readOptionalConfigBoolean("on")).toBe(true);
    expect(readOptionalConfigBoolean("1")).toBe(true);
    expect(readOptionalConfigBoolean(" false ")).toBe(false);
    expect(readOptionalConfigBoolean("NO")).toBe(false);
    expect(readOptionalConfigBoolean("off")).toBe(false);
    expect(readOptionalConfigBoolean("0")).toBe(false);
    expect(readOptionalConfigBoolean("")).toBeUndefined();
    expect(readOptionalConfigBoolean("maybe")).toBeUndefined();
    expect(readOptionalConfigBoolean(1)).toBeUndefined();
    expect(readOptionalConfigBoolean(undefined)).toBeUndefined();
  });

  it("normalizes optional positive integer config values", () => {
    expect(readOptionalConfigPositiveInteger(" 2500 ")).toBe(2500);
    expect(readOptionalConfigPositiveInteger(2500.8)).toBe(2500);
    expect(readOptionalConfigPositiveInteger("0")).toBeUndefined();
    expect(readOptionalConfigPositiveInteger("0.5")).toBeUndefined();
    expect(readOptionalConfigPositiveInteger("-1")).toBeUndefined();
    expect(readOptionalConfigPositiveInteger("not-a-number")).toBeUndefined();
    expect(readOptionalConfigPositiveInteger(undefined)).toBeUndefined();
  });

  it("normalizes HTTP config URLs", () => {
    expect(normalizeHttpConfigUrl(" https://api.example.test/v1/// ")).toBe("https://api.example.test/v1");
    expect(normalizeHttpConfigUrl("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(normalizeHttpConfigUrl("file:///tmp/config")).toBeUndefined();
    expect(normalizeHttpConfigUrl("not a url")).toBeUndefined();
    expect(normalizeHttpConfigUrl(undefined)).toBeUndefined();
  });

  it("reads selected config fields and drops invalid values", () => {
    const config = readConfigFields<{
      baseUrl?: string;
      model?: string;
      timeoutMs?: number;
      enabled?: boolean;
      effort?: string | null;
    }>(
      {
        baseUrl: " https://api.example.test/v1/// ",
        model: "  ",
        timeoutMs: "2500",
        enabled: "false",
        effort: null,
      },
      {
        baseUrl: normalizeHttpConfigUrl,
        model: readOptionalConfigString,
        timeoutMs: readOptionalConfigPositiveInteger,
        enabled: readOptionalConfigBoolean,
        effort: (value) => value === null ? null : readOptionalConfigString(value),
      },
    );

    expect(config).toEqual({
      baseUrl: "https://api.example.test/v1",
      timeoutMs: 2500,
      enabled: false,
      effort: null,
    });
  });

  it("merges config field layers with later valid values taking precedence", () => {
    const config = readLayeredConfigFields<{
      baseUrl?: string;
      model?: string;
      timeoutMs?: number;
      effort?: string | null;
    }>(
      [
        {
          baseUrl: "https://env.example.test/v1",
          model: "env-model",
          timeoutMs: "2500",
          effort: "high",
        },
        {
          baseUrl: "https://file.example.test/v1/",
          timeoutMs: "not-a-number",
          effort: null,
        },
      ],
      {
        baseUrl: normalizeHttpConfigUrl,
        model: readOptionalConfigString,
        timeoutMs: readOptionalConfigPositiveInteger,
        effort: (value) => value === null ? null : readOptionalConfigString(value),
      },
    );

    expect(config).toEqual({
      baseUrl: "https://file.example.test/v1",
      model: "env-model",
      timeoutMs: 2500,
      effort: null,
    });
  });

  it("reads selected fields from an optional JSON config file", () => {
    const configPath = tempConfigPath();
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        baseUrl: "https://api.example.test/v1",
        model: "test-model",
      }),
      "utf8",
    );

    expect(
      readJsonConfigFields<{
        baseUrl?: string;
        model?: string;
      }>(configPath, {
        baseUrl: normalizeHttpConfigUrl,
        model: readOptionalConfigString,
      }),
    ).toEqual({
      baseUrl: "https://api.example.test/v1",
      model: "test-model",
    });

    expect(
      readJsonConfigFields<{ model?: string }>(tempConfigPath("missing-fields.json"), {
        model: readOptionalConfigString,
      }),
    ).toEqual({});
  });

  it("merges selected fields from inline config and an optional JSON config file", () => {
    const configPath = tempConfigPath();
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        baseUrl: "https://file.example.test/v1/",
        model: "file-model",
        timeoutMs: "not-a-number",
      }),
      "utf8",
    );

    expect(
      readLayeredJsonConfigFields<{
        baseUrl?: string;
        model?: string;
        timeoutMs?: number;
      }>(
        [
          {
            baseUrl: "https://env.example.test/v1",
            model: "env-model",
            timeoutMs: "2500",
          },
        ],
        configPath,
        {
          baseUrl: normalizeHttpConfigUrl,
          model: readOptionalConfigString,
          timeoutMs: readOptionalConfigPositiveInteger,
        },
      ),
    ).toEqual({
      baseUrl: "https://file.example.test/v1",
      model: "file-model",
      timeoutMs: 2500,
    });
  });

  it("maps source config fields into runtime field names", () => {
    expect(
      mapConfigSourceFields(
        {
          EMBEDDING_BASE_URL: "https://api.example.test/v1/",
          EMBEDDING_MODEL: "text-embedding-3-small",
          UNUSED: "ignored",
        },
        {
          baseUrl: "EMBEDDING_BASE_URL",
          model: "EMBEDDING_MODEL",
        },
      ),
    ).toEqual({
      baseUrl: "https://api.example.test/v1/",
      model: "text-embedding-3-small",
    });
  });

  it("reads layered config from mapped source fields and an optional JSON config file", () => {
    const configPath = tempConfigPath();
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        baseUrl: "https://file.example.test/v1/",
        timeoutMs: "not-a-number",
      }),
      "utf8",
    );

    expect(
      readLayeredMappedJsonConfigFields(
        {
          MEMORY_LLM_BASE_URL: "https://env.example.test/v1",
          MEMORY_LLM_MODEL: "claude-haiku-4-5-20251001",
          MEMORY_LLM_TIMEOUT_MS: "2500",
        },
        {
          baseUrl: "MEMORY_LLM_BASE_URL",
          model: "MEMORY_LLM_MODEL",
          timeoutMs: "MEMORY_LLM_TIMEOUT_MS",
        },
        configPath,
        {
          baseUrl: normalizeHttpConfigUrl,
          model: readOptionalConfigString,
          timeoutMs: readOptionalConfigPositiveInteger,
        },
      ),
    ).toEqual({
      baseUrl: "https://file.example.test/v1",
      model: "claude-haiku-4-5-20251001",
      timeoutMs: 2500,
    });
  });

  it("loads runtime governance config from managed file over env defaults", async () => {
    const configPath = tempConfigPath("runtime-config.json");
    await writeRuntimeGovernanceConfigFile(configPath, {
      WRITEBACK_MAINTENANCE_ENABLED: true,
      WRITEBACK_MAINTENANCE_INTERVAL_MS: 300000,
      WRITEBACK_GOVERNANCE_VERIFY_ENABLED: false,
      WRITEBACK_GOVERNANCE_SHADOW_MODE: true,
      WRITEBACK_MAINTENANCE_MAX_ACTIONS: 4,
    });

    expect(
      resolveRuntimeGovernanceConfig({
        AXIS_RUNTIME_CONFIG_PATH: configPath,
        WRITEBACK_MAINTENANCE_ENABLED: false,
        WRITEBACK_MAINTENANCE_INTERVAL_MS: 900000,
        WRITEBACK_GOVERNANCE_VERIFY_ENABLED: true,
        WRITEBACK_GOVERNANCE_SHADOW_MODE: false,
        WRITEBACK_MAINTENANCE_MAX_ACTIONS: 10,
      }),
    ).toEqual({
      WRITEBACK_MAINTENANCE_ENABLED: true,
      WRITEBACK_MAINTENANCE_INTERVAL_MS: 300000,
      WRITEBACK_GOVERNANCE_VERIFY_ENABLED: false,
      WRITEBACK_GOVERNANCE_SHADOW_MODE: true,
      WRITEBACK_MAINTENANCE_MAX_ACTIONS: 4,
    });
  });
});
