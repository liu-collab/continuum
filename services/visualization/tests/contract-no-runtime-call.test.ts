import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const apiRoutesRoot = path.join(process.cwd(), "src", "app", "api");
const blockedFragments = ["/prepare-context", "/finalize-turn", "prepareContext(", "finalizeTurn("];

function collectRouteFiles(root: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectRouteFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name === "route.ts") {
      results.push(fullPath);
    }
  }
  return results;
}

describe("visualization api contract", () => {
  it("does not call memory-native-agent prepare-context or finalize-turn routes", () => {
    const files = collectRouteFiles(apiRoutesRoot);
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      for (const fragment of blockedFragments) {
        expect(content).not.toContain(fragment);
      }
    }
  });
});
