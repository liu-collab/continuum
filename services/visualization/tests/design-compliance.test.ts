import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("visualization design compliance", () => {
  it("uses the design letter spacing tokens for global typography", () => {
    const css = readSource("src/app/globals.css");

    expect(css).toMatch(/body\s*\{[\s\S]*letter-spacing:\s*-0\.374px;/);
    expect(css).toMatch(/\.tile-title\s*\{[\s\S]*letter-spacing:\s*-0\.28px;/);
    expect(css).toMatch(/\.page-title\s*\{[\s\S]*letter-spacing:\s*-0\.28px;/);
    expect(css).toMatch(/\.tile-subtitle\s*\{[\s\S]*letter-spacing:\s*0\.196px;/);
    expect(css).toMatch(/\.page-lead\s*\{[\s\S]*letter-spacing:\s*0\.196px;/);
    expect(css).toMatch(/\.section-kicker\s*\{[\s\S]*letter-spacing:\s*-0\.224px;/);
    expect(css).toMatch(/\.global-nav-link\s*\{[\s\S]*letter-spacing:\s*-0\.12px;/);
  });

  it("does not use the excluded 500 font weight in audited components", () => {
    const filterBar = readSource("src/components/filter-bar.tsx");
    const assistantThread = readSource("src/app/agent/_components/assistant-thread.tsx");

    expect(filterBar).not.toContain("fontWeight: 500");
    expect(assistantThread).not.toMatch(/text-\[12px\] font-medium uppercase/);
  });
});
