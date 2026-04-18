import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupExpiredArtifacts } from "../artifacts.js";
import { resolveArtifactsRoot } from "../token.js";

const tempRoots: string[] = [];

function createTempHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mna-artifacts-"));
  tempRoots.push(root);
  return root;
}

describe("artifact cleanup", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes expired artifact session directories only", () => {
    const home = createTempHome();
    const artifactsRoot = resolveArtifactsRoot(home);
    fs.mkdirSync(artifactsRoot, { recursive: true });

    const expiredDir = path.join(artifactsRoot, "expired-session");
    const freshDir = path.join(artifactsRoot, "fresh-session");
    fs.mkdirSync(expiredDir, { recursive: true });
    fs.mkdirSync(freshDir, { recursive: true });
    fs.writeFileSync(path.join(expiredDir, "call-1.txt"), "expired", "utf8");
    fs.writeFileSync(path.join(freshDir, "call-2.txt"), "fresh", "utf8");

    const now = Date.now();
    const expiredAt = new Date(now - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(expiredDir, expiredAt, expiredAt);
    fs.utimesSync(path.join(expiredDir, "call-1.txt"), expiredAt, expiredAt);

    const result = cleanupExpiredArtifacts({
      homeDirectory: home,
      now,
    });

    expect(result.removed).toEqual(["expired-session"]);
    expect(fs.existsSync(expiredDir)).toBe(false);
    expect(fs.existsSync(freshDir)).toBe(true);
  });
});
