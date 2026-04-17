import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/args.js";
import {
  buildEmbeddingsEndpoint,
  resolveThirdPartyEmbeddingConfig,
} from "../src/embedding-config.js";
import { renderHelp } from "../src/help.js";
import { runStatusCommand } from "../src/status-command.js";

describe("continuum cli", () => {
  it("parses command and options", () => {
    const parsed = parseArgs(["status", "--json", "--runtime-url", "http://127.0.0.1:3002"]);

    expect(parsed.command).toEqual(["status"]);
    expect(parsed.options.json).toBe(true);
    expect(parsed.options["runtime-url"]).toBe("http://127.0.0.1:3002");
  });

  it("parses the start command and exposes it in help", () => {
    const parsed = parseArgs([
      "start",
      "--open",
      "--postgres-port",
      "54329",
      "--bind-host",
      "0.0.0.0",
      "--embedding-base-url",
      "https://api.openai.com/v1",
      "--embedding-model",
      "text-embedding-3-small",
    ]);

    expect(parsed.command).toEqual(["start"]);
    expect(parsed.options.open).toBe(true);
    expect(parsed.options["postgres-port"]).toBe("54329");
    expect(parsed.options["bind-host"]).toBe("0.0.0.0");
    expect(parsed.options["embedding-base-url"]).toBe("https://api.openai.com/v1");
    expect(parsed.options["embedding-model"]).toBe("text-embedding-3-small");
    expect(renderHelp()).toContain("continuum start");
    expect(renderHelp()).toContain("--bind-host HOST");
    expect(renderHelp()).toContain("--embedding-base-url URL");
  });

  it("parses the stop command and exposes it in help", () => {
    const parsed = parseArgs(["stop"]);

    expect(parsed.command).toEqual(["stop"]);
    expect(renderHelp()).toContain("continuum stop");
  });

  it("returns non-zero when strict status checks fail", async () => {
    const exitCode = await runStatusCommand({
      json: true,
      strict: true,
      "runtime-url": "http://127.0.0.1:39992",
      "storage-url": "http://127.0.0.1:39991",
      "ui-url": "http://127.0.0.1:39993",
      timeout: "50",
    });

    expect(exitCode).toBe(1);
  });

  it("requires third-party embedding config for managed start", () => {
    expect(() => resolveThirdPartyEmbeddingConfig({}, {})).toThrow(
      "continuum start 需要第三方 embedding 配置",
    );
  });

  it("accepts third-party embedding config from options and preserves v1 path", () => {
    const config = resolveThirdPartyEmbeddingConfig(
      {
        "embedding-base-url": "https://api.openai.com/v1",
        "embedding-model": "text-embedding-3-small",
      },
      {},
    );

    expect(config.baseUrl).toBe("https://api.openai.com/v1");
    expect(buildEmbeddingsEndpoint(config.baseUrl)).toBe("https://api.openai.com/v1/embeddings");
  });
});
