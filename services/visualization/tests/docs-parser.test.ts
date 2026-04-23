import { describe, expect, it } from "vitest";

import { createSlug, extractDocHeadings, renderMarkdownDocument } from "@/lib/server/docs";

describe("docs parser", () => {
  it("extracts heading anchors for the document outline", () => {
    const headings = extractDocHeadings(`# 标题

## 1. 项目概览

### 1.1 核心能力

## 2. 系统架构
`);

    expect(headings).toEqual([
      { id: "1-项目概览", level: 2, text: "1. 项目概览" },
      { id: "11-核心能力", level: 3, text: "1.1 核心能力" },
      { id: "2-系统架构", level: 2, text: "2. 系统架构" },
    ]);
  });

  it("renders markdown into anchored html", () => {
    const document = renderMarkdownDocument(`## 1. 项目概览

这里有 \`MCP\`。

- skills
- 环境变量
`);

    expect(document.html).toContain('<h2 id="1-项目概览">1. 项目概览</h2>');
    expect(document.html).toContain("<code>MCP</code>");
    expect(document.html).toContain("<li>skills</li>");
    expect(document.headings).toHaveLength(1);
  });

  it("creates stable slugs", () => {
    expect(createSlug(" 1. 项目概览 ")).toBe("1-项目概览");
  });
});
