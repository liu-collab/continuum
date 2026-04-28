import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
}));

import HomePage from "@/app/page";

describe("home page", () => {
  it("links to all visualization modules", async () => {
    const element = await HomePage();
    render(element);

    expect(screen.getByRole("link", { name: /运行时指标/ })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /记忆目录/ })).toHaveAttribute("href", "/memories");
    expect(screen.getByRole("link", { name: /运行轨迹/ })).toHaveAttribute("href", "/runs");
    expect(screen.getByRole("link", { name: /记忆治理/ })).toHaveAttribute("href", "/governance");
    expect(screen.getByRole("link", { name: /项目文档/ })).toHaveAttribute("href", "/docs/configuration");
    expect(screen.getByRole("link", { name: /Agent 工作台/ })).toHaveAttribute("href", "/agent");
  });
});
