import { afterEach, describe, expect, it, vi } from "vitest";

const getManagedMnaStatusMock = vi.hoisted(() => vi.fn());

vi.mock("../src/mna-command.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/mna-command.js")>();
  return {
    ...actual,
    getManagedMnaStatus: getManagedMnaStatusMock
  };
});

import { parseArgs } from "../src/args.js";
import {
  buildEmbeddingsEndpoint,
  resolveThirdPartyEmbeddingConfig,
} from "../src/embedding-config.js";
import { renderHelp } from "../src/help.js";
import { resolveManagedMnaProviderConfig } from "../src/mna-provider-config.js";
import { runStatusCommand } from "../src/status-command.js";

describe("continuum cli", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    getManagedMnaStatusMock.mockReset();
  });

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
    getManagedMnaStatusMock.mockResolvedValue({
      record: null,
      url: "http://127.0.0.1:4193",
      tokenPath: "C:/tmp/.mna/token.txt",
      artifactsPath: "C:/tmp/.mna/artifacts",
      health: {
        ok: false,
        status: 503,
        error: "unavailable"
      },
      dependency: {
        body: null
      }
    });

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

  it("prints mna details in status --json output", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    getManagedMnaStatusMock.mockResolvedValue({
      record: null,
      url: "http://127.0.0.1:4193",
      tokenPath: "C:/tmp/.mna/token.txt",
      artifactsPath: "C:/tmp/.mna/artifacts",
      health: {
        ok: false,
        status: 503,
        error: "unavailable"
      },
      dependency: {
        body: {
          runtime: {
            status: "unavailable"
          }
        }
      }
    });

    const exitCode = await runStatusCommand({
      json: true,
      strict: false,
      "runtime-url": "http://127.0.0.1:39992",
      "storage-url": "http://127.0.0.1:39991",
      "ui-url": "http://127.0.0.1:39993",
      timeout: "50",
      "mna-url": "http://127.0.0.1:4193",
      "mna-home": "C:/tmp/.mna"
    });

    expect(exitCode).toBe(1);
    const payload = JSON.parse(String(stdoutSpy.mock.calls[0]?.[0])) as {
      mna: {
        url: string;
        tokenPath: string;
        artifactsPath: string;
        dependency: unknown;
      };
    };
    expect(payload.mna.url).toBe("http://127.0.0.1:4193");
    expect(payload.mna.tokenPath).toBe("C:/tmp/.mna/token.txt");
    expect(payload.mna.artifactsPath).toBe("C:/tmp/.mna/artifacts");
    expect(payload.mna).toHaveProperty("dependency");
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
