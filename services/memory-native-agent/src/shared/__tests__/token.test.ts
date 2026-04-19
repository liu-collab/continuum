import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadOrCreateToken, resolveArtifactsRoot, resolveMnaHomeDirectory, resolveTokenPath } from "../token.js";

const tempRoots: string[] = [];

function createTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mna-token-"));
  tempRoots.push(home);
  return home;
}

describe("loadOrCreateToken", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("creates a new token file when missing", () => {
    const home = createTempHome();
    const result = loadOrCreateToken(home);

    expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.tokenPath).toBe(resolveTokenPath(home));
    expect(fs.readFileSync(result.tokenPath, "utf8").trim()).toBe(result.token);
  });

  it("reuses an existing token file", () => {
    const home = createTempHome();
    const tokenPath = resolveTokenPath(home);
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, "persisted-token", "utf8");

    const result = loadOrCreateToken(home);
    expect(result.token).toBe("persisted-token");
  });

  it("uses MNA_HOME when no explicit homeDirectory is passed", () => {
    const home = createTempHome();
    const previousHome = process.env.MNA_HOME;
    process.env.MNA_HOME = home;

    try {
      expect(resolveMnaHomeDirectory()).toBe(home);
      expect(resolveTokenPath()).toBe(path.join(home, "token.txt"));
      expect(resolveArtifactsRoot()).toBe(path.join(home, "artifacts"));
    } finally {
      if (previousHome === undefined) {
        delete process.env.MNA_HOME;
      } else {
        process.env.MNA_HOME = previousHome;
      }
    }
  });
});
