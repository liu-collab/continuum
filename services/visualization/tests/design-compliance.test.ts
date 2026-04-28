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

  it("keeps audited agent UI colors on design tokens instead of secondary accent palettes", () => {
    const auditedFiles = [
      "src/app/agent/_components/assistant-thread.tsx",
      "src/app/agent/_components/chat-panel.tsx",
      "src/app/agent/_components/confirm-dialog.tsx",
      "src/app/agent/_components/file-tree.tsx",
      "src/app/agent/_components/mcp-panel.tsx",
      "src/app/agent/_components/settings-modal.tsx"
    ];
    const source = auditedFiles.map(readSource).join("\n");

    expect(source).not.toMatch(/\b(?:border|bg|text)-(?:rose|amber|emerald)-\d+/);
  });

  it("tokenizes audited hardcoded CSS colors", () => {
    const css = readSource("src/app/globals.css");
    const modal = readSource("src/components/modal.tsx");

    expect(css).toContain("--surface-active: var(--surface-pearl);");
    expect(css).toContain("--cyan-bg: var(--surface-pearl);");
    expect(css).toContain("--emerald-bg: var(--surface-pearl);");
    expect(css).toContain("--record-active-fill:");
    expect(css).toContain("--nav-link-default:");
    expect(css).toContain("--nav-border:");
    expect(css).not.toContain("--surface-active: #f2f2f5");
    expect(css).not.toContain("--cyan-bg: #f2f7ff");
    expect(css).not.toContain("--emerald-bg: #f2f7ff");
    expect(css).not.toContain("background: #f2f7ff");
    expect(css).not.toContain("rgba(255, 255, 255, 0.84)");
    expect(css).not.toContain("rgba(255, 255, 255, 0.14)");
    expect(modal).not.toContain("bg-black/35");
    expect(modal).toContain("bg-[var(--modal-backdrop)]");
  });

  it("uses the design font size and radius ladder in audited controls", () => {
    const css = readSource("src/app/globals.css");
    const fileTree = readSource("src/app/agent/_components/file-tree.tsx");

    expect(css).toMatch(/\.field\s*\{[\s\S]*font-size:\s*14px;/);
    expect(css).toMatch(/\.field-button\s*\{[\s\S]*font-size:\s*14px;/);
    expect(fileTree).not.toContain("text-[11px]");
    expect(fileTree).not.toContain("rounded-xl");
    expect(fileTree).toContain("rounded-[var(--radius-lg)]");
  });

  it("does not keep removed overlay shadow utilities on audited modals", () => {
    const confirmDialog = readSource("src/app/agent/_components/confirm-dialog.tsx");

    expect(confirmDialog).not.toContain("shadow-overlay");
  });

  it("keeps record link active interactions on the shared press scale", () => {
    const css = readSource("src/app/globals.css");

    expect(css).toMatch(/\.record-link:active\s*\{[\s\S]*transform:\s*scale\(0\.95\);/);
    expect(css).not.toMatch(/\.record-link:active\s*\{[\s\S]*transform:\s*scale\(0\.99\);/);
  });
});
