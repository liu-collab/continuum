import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/docs", () => ({
  renderRepositoryMarkdown: vi.fn(async () => ({
    html: `
      <h2 id="1-项目概览">1. 项目概览</h2>
      <p>这里有 <code>MCP</code>。</p>
      <ul><li>skills</li><li>环境变量</li></ul>
    `,
    headings: [
      { id: "1-项目概览", level: 2, text: "1. 项目概览" },
      { id: "2-系统架构", level: 2, text: "2. 系统架构" },
    ],
  })),
}));

import ConfigurationDocPage from "@/app/docs/configuration/page";

describe("configuration doc page", () => {
  it("renders markdown content and the outline", async () => {
    const element = await ConfigurationDocPage();
    render(element);

    expect(screen.getByText("项目技术文档")).toBeInTheDocument();
    expect(screen.getByText("1. 项目概览")).toBeInTheDocument();
    expect(screen.getByText("MCP")).toBeInTheDocument();
    expect(screen.getByText("skills")).toBeInTheDocument();
    expect(screen.getByText("环境变量")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "项目概览" })).toHaveAttribute("href", "#1-项目概览");
    expect(screen.getByRole("link", { name: "系统架构" })).toHaveAttribute("href", "#2-系统架构");
  });
});
