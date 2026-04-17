import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/args.js";
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
    ]);

    expect(parsed.command).toEqual(["start"]);
    expect(parsed.options.open).toBe(true);
    expect(parsed.options["postgres-port"]).toBe("54329");
    expect(parsed.options["bind-host"]).toBe("0.0.0.0");
    expect(renderHelp()).toContain("continuum start");
    expect(renderHelp()).toContain("--bind-host HOST");
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
});
