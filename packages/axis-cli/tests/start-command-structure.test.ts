import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readSource(relativePath: string) {
  return await readFile(path.join(packageRoot, relativePath), "utf8");
}

describe("start-command module layout", () => {
  it("keeps start orchestration separate from shared helpers", async () => {
    const startCommand = await readSource("src/start-command.ts");
    const dockerLifecycle = await readSource("src/docker-lifecycle.ts");
    const portUtils = await readSource("src/port-utils.ts");
    const vendorRefresh = await readSource("src/vendor-refresh.ts");
    const managedProcess = await readSource("src/managed-process.ts");

    expect(startCommand).toContain(`from "./docker-lifecycle.js"`);
    expect(startCommand).toContain(`from "./port-utils.js"`);
    expect(startCommand).toContain(`from "./vendor-refresh.js"`);
    expect(startCommand).toContain(`from "./managed-process.js"`);
    expect(startCommand).not.toMatch(
      /function\s+(ensureDockerInstalled|ensureDockerDaemonReady|prepareStackContext|resolveUiDevPort|refreshVisualizationVendor)\b/,
    );

    expect(dockerLifecycle).toContain("export async function ensureDockerInstalled");
    expect(dockerLifecycle).toContain("export async function prepareStackContext");
    expect(portUtils).toContain("export async function resolveManagedPostgresPort");
    expect(vendorRefresh).toContain("export async function refreshVisualizationVendor");
    expect(managedProcess).toContain("export async function runForeground");
  });
});
