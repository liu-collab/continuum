import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadOrCreateToken, resolveTokenPath } from "../token.js";

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
});
