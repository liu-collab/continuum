import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).reverse().map((cleanup) => cleanup()));
});

describe("mna server process start", () => {
  it("exits with code 3 when the configured port is already occupied", async () => {
    const occupied = net.createServer();
    const occupiedPort = await new Promise<number>((resolve) => {
      occupied.listen(0, "127.0.0.1", () => {
        const address = occupied.address();
        if (!address || typeof address === "string") {
          throw new Error("occupied port unavailable");
        }
        resolve(address.port);
      });
    });
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          occupied.close(() => resolve());
        }),
    );

    const homeDir = await createTempHome("mna-port-conflict-");
    const result = await runMnaProcess({
      MNA_HOME: homeDir,
      MNA_HOST: "127.0.0.1",
      MNA_PORT: String(occupiedPort),
      RUNTIME_BASE_URL: "http://127.0.0.1:9",
    });

    expect(result.code).toBe(3);
    expect(result.stderr).toContain("端口");
    expect(result.stderr).toContain("已被占用");
  }, 20_000);
});

async function createTempHome(prefix: string) {
  const homeDir = path.join(os.tmpdir(), `${prefix}${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(homeDir, { recursive: true });
  cleanups.push(() => rm(homeDir, { recursive: true, force: true }));
  return homeDir;
}

async function runMnaProcess(envOverrides: Record<string, string>) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["bin/mna-server.mjs"], {
      cwd: path.resolve(process.cwd()),
      env: {
        ...process.env,
        NODE_ENV: "test",
        HOME: envOverrides.MNA_HOME,
        USERPROFILE: envOverrides.MNA_HOME,
        ...envOverrides,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `timed out waiting for mna process to exit\nstdout=${Buffer.concat(stdoutChunks).toString("utf8")}\nstderr=${Buffer.concat(
            stderrChunks,
          ).toString("utf8")}`,
        ),
      );
    }, 10_000);
    child.stdout?.on("data", (chunk) => stdoutChunks.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });
  });
}
