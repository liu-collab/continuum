import { afterEach, describe, expect, it, vi } from "vitest";

const readManagedMemoryLlmConfigMock = vi.hoisted(() => vi.fn());
const writeManagedMemoryLlmConfigMock = vi.hoisted(() => vi.fn());

vi.mock("../src/managed-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/managed-config.js")>();
  return {
    ...actual,
    readManagedMemoryLlmConfig: readManagedMemoryLlmConfigMock,
    writeManagedMemoryLlmConfig: writeManagedMemoryLlmConfigMock,
  };
});

import {
  runMemoryModelCommand,
  writeMemoryModelConfigurationHint,
} from "../src/memory-model-command.js";

describe("axis memory-model command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    readManagedMemoryLlmConfigMock.mockReset();
    writeManagedMemoryLlmConfigMock.mockReset();
  });

  it("writes memory model config from friendly aliases", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    readManagedMemoryLlmConfigMock.mockResolvedValue(null);
    writeManagedMemoryLlmConfigMock.mockResolvedValue(undefined);

    await expect(runMemoryModelCommand("configure", {
      "base-url": "https://api.example.com/v1",
      model: "memory-model",
      "api-key": "secret",
      protocol: "openai-compatible",
      "timeout-ms": "9000",
    })).resolves.toBe(0);

    expect(writeManagedMemoryLlmConfigMock).toHaveBeenCalledWith({
      version: 1,
      baseUrl: "https://api.example.com/v1",
      model: "memory-model",
      apiKey: "secret",
      protocol: "openai-compatible",
      timeoutMs: 9000,
    });
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("记忆模型配置已保存"));
  });

  it("prints a skip-friendly hint only when memory model is missing", async () => {
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    readManagedMemoryLlmConfigMock.mockResolvedValueOnce(null);

    await writeMemoryModelConfigurationHint();

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("记忆模型未配置"));

    stdoutSpy.mockClear();
    readManagedMemoryLlmConfigMock.mockResolvedValueOnce({
      version: 1,
      baseUrl: "https://api.example.com/v1",
      model: "memory-model",
    });

    await writeMemoryModelConfigurationHint();

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
