import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/args.js";
import {
  buildEmbeddingsEndpoint,
  resolveThirdPartyEmbeddingConfig,
} from "../src/embedding-config.js";
import { renderHelp } from "../src/help.js";
import { resolveManagedMnaProviderConfig } from "../src/mna-provider-config.js";
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
      "--provider-kind",
      "openai-compatible",
      "--provider-model",
      "deepseek-chat",
    ]);

    expect(parsed.command).toEqual(["start"]);
    expect(parsed.options.open).toBe(true);
    expect(parsed.options["postgres-port"]).toBe("54329");
    expect(parsed.options["bind-host"]).toBe("0.0.0.0");
    expect(parsed.options["embedding-base-url"]).toBe("https://api.openai.com/v1");
    expect(parsed.options["embedding-model"]).toBe("text-embedding-3-small");
    expect(parsed.options["provider-kind"]).toBe("openai-compatible");
    expect(parsed.options["provider-model"]).toBe("deepseek-chat");
    expect(renderHelp()).toContain("continuum start");
    expect(renderHelp()).toContain("--bind-host HOST");
    expect(renderHelp()).toContain("--embedding-base-url URL");
    expect(renderHelp()).toContain("--provider-kind KIND");
  });

  it("parses the stop command and exposes it in help", () => {
    const parsed = parseArgs(["stop"]);

    expect(parsed.command).toEqual(["stop"]);
    expect(renderHelp()).toContain("continuum stop");
  });

  it("parses the mna command and exposes it in help", () => {
    const parsed = parseArgs(["mna", "start", "--mna-port", "4193", "--mna-home", "C:/tmp/.mna"]);

    expect(parsed.command).toEqual(["mna", "start"]);
    expect(parsed.options["mna-port"]).toBe("4193");
    expect(parsed.options["mna-home"]).toBe("C:/tmp/.mna");
    expect(renderHelp()).toContain("continuum mna <install|start|stop|logs|token>");
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

  it("falls back to demo provider when no model credential is available", () => {
    const config = resolveManagedMnaProviderConfig({}, {});

    expect(config).toEqual({
      kind: "demo",
      model: "continuum-demo",
      baseUrl: undefined,
    });
  });

  it("prefers DeepSeek env as managed openai-compatible provider", () => {
    const config = resolveManagedMnaProviderConfig({}, {
      DEEPSEEK_API_KEY: "demo-key",
    });

    expect(config).toEqual({
      kind: "openai-compatible",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
  });
});
