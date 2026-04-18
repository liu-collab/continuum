import { afterEach, describe, expect, it } from "vitest";

import { start, stop } from "../src/index.js";

describe("memory-native-agent smoke", () => {
  const startedApps: Awaited<ReturnType<typeof start>>[] = [];

  afterEach(async () => {
    await Promise.all(startedApps.splice(0).map((app) => stop(app)));
  });

  it("starts the service and serves /healthz", async () => {
    const app = await start({ port: 0 });
    startedApps.push(app);

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("server address is not available");
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    const payload = (await response.json()) as {
      status: string;
      version: string;
      dependencies: {
        retrieval_runtime: string;
      };
    };

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      status: "ok",
      version: "0.1.0",
      dependencies: {
        retrieval_runtime: "unknown",
      },
    });
    expect(app.mnaToken).toMatch(/^[a-f0-9]{64}$/);
    expect(app.mnaTokenPath).toContain(".mna");
  });
});
