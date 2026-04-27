import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { createLogger, runWithLogContext, updateLogContext } from "../src/logger.js";

function makeConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/agent_memory",
    STORAGE_WRITEBACK_URL: "http://localhost:3001",
    ...overrides,
  } as unknown as NodeJS.ProcessEnv);
}

function createMemoryDestination() {
  const lines: string[] = [];
  return {
    destination: {
      write(message: string) {
        lines.push(...message.split("\n").filter(Boolean));
      },
    },
    lines,
  };
}

describe("retrieval-runtime logger", () => {
  it("defaults to full log retention", () => {
    const config = makeConfig();

    expect(config.LOG_SAMPLE_RATE).toBe(1);
  });

  it("rejects invalid log sample rates", () => {
    expect(() => makeConfig({ LOG_SAMPLE_RATE: "-0.1" })).toThrow("Invalid retrieval-runtime configuration");
    expect(() => makeConfig({ LOG_SAMPLE_RATE: "1.1" })).toThrow("Invalid retrieval-runtime configuration");
    expect(() => makeConfig({ LOG_SAMPLE_RATE: "not-a-number" })).toThrow(
      "Invalid retrieval-runtime configuration",
    );
  });

  it("keeps lower-level logs without sampling at the full rate", () => {
    const { destination, lines } = createMemoryDestination();
    let randomCalls = 0;
    const logger = createLogger(makeConfig({ LOG_LEVEL: "trace", LOG_SAMPLE_RATE: "1" }), {
      destination,
      random: () => {
        randomCalls += 1;
        return 1;
      },
    });

    logger.trace("kept trace");
    logger.debug("kept debug");
    logger.info("kept info");

    const messages = lines.map((line) => JSON.parse(line) as { msg: string });
    expect(randomCalls).toBe(0);
    expect(messages.map((message) => message.msg)).toEqual(["kept trace", "kept debug", "kept info"]);
  });

  it("samples trace, debug, and info logs using the configured rate", () => {
    const { destination, lines } = createMemoryDestination();
    const randomValues = [0.4, 0.6, 0.49];
    const logger = createLogger(makeConfig({ LOG_LEVEL: "trace", LOG_SAMPLE_RATE: "0.5" }), {
      destination,
      random: () => randomValues.shift() ?? 1,
    });

    logger.trace("kept trace");
    logger.debug("dropped debug");
    logger.info("kept info");

    const messages = lines.map((line) => JSON.parse(line) as { msg: string });
    expect(messages.map((message) => message.msg)).toEqual(["kept trace", "kept info"]);
  });

  it("keeps warn, error, and fatal logs when sampling drops lower levels", () => {
    const { destination, lines } = createMemoryDestination();
    const logger = createLogger(makeConfig({ LOG_SAMPLE_RATE: "0" }), {
      destination,
      random: () => 1,
    });

    logger.info("dropped info");
    logger.warn("kept warn");
    logger.error("kept error");
    logger.fatal("kept fatal");

    const messages = lines.map((line) => JSON.parse(line) as { level: number; msg: string });
    expect(messages).toEqual([
      expect.objectContaining({ level: 40, msg: "kept warn" }),
      expect.objectContaining({ level: 50, msg: "kept error" }),
      expect.objectContaining({ level: 60, msg: "kept fatal" }),
    ]);
  });

  it("adds contextual fields and supports async context updates", async () => {
    const { destination, lines } = createMemoryDestination();
    const logger = createLogger(makeConfig({ LOG_LEVEL: "info" }), {
      destination,
    });

    await runWithLogContext({ request_id: "req-1", http_path: "/v1/test" }, async () => {
      logger.info("before trace");
      await Promise.resolve();
      updateLogContext({ trace_id: "trace-1" });
      logger.info("after trace");
    });

    const messages = lines.map((line) => JSON.parse(line) as { msg: string; request_id?: string; http_path?: string; trace_id?: string });
    expect(messages).toEqual([
      expect.objectContaining({
        msg: "before trace",
        request_id: "req-1",
        http_path: "/v1/test",
      }),
      expect.objectContaining({
        msg: "after trace",
        request_id: "req-1",
        http_path: "/v1/test",
        trace_id: "trace-1",
      }),
    ]);
  });

  it("uses one lower-level sampling decision within a log context", () => {
    const { destination, lines } = createMemoryDestination();
    const randomValues = [0.6, 0.2];
    const logger = createLogger(makeConfig({ LOG_LEVEL: "trace", LOG_SAMPLE_RATE: "0.5" }), {
      destination,
      random: () => randomValues.shift() ?? 1,
    });

    runWithLogContext({ request_id: "dropped-request" }, () => {
      logger.info("dropped info");
      logger.debug("dropped debug");
    });
    runWithLogContext({ request_id: "kept-request" }, () => {
      logger.info("kept info");
      logger.debug("kept debug");
    });

    const messages = lines.map((line) => JSON.parse(line) as { msg: string; request_id?: string });
    expect(messages).toEqual([
      expect.objectContaining({ msg: "kept info", request_id: "kept-request" }),
      expect.objectContaining({ msg: "kept debug", request_id: "kept-request" }),
    ]);
    expect(randomValues).toEqual([]);
  });
});
