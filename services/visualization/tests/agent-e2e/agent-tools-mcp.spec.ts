import { expect, test } from "@playwright/test";

import { AgentPage } from "./agent-page";

test.describe("agent tools and mcp", () => {
  test("shows confirm dialog, records tool execution, and manages MCP state", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();
    await agent.expectMcpServerVisible("echo-http");
    await expect(agent.mcpPanel()).toContainText(/正常|ok/i);

    await agent.sendMessage("请读取 README.md");
    await agent.expectToolConsoleContains(/fs_read/);
    await agent.expectToolConsoleContains(/内置只读|Built-in read|builtin read/i);

    await agent.sendMessage("请创建文件");
    await agent.expectToolConfirmDialog();
    await agent.denyTool();
    await agent.expectToolConsoleContains(/fs_write/);
    await agent.expectToolConsoleContains(/denied|拒绝|Tool execution was denied/i);

    await agent.sendMessage("请创建文件");
    await agent.expectToolConfirmDialog();
    await agent.allowToolForSession();
    await agent.expectToolConsoleContains(/builtin_write|内置写入/i);

    await agent.sendMessage("请调用 MCP echo");
    await agent.expectToolConfirmDialog();
    await agent.allowTool();
    await agent.expectToolConsoleContains(/mcp_call/);
    await agent.expectToolConsoleContains(/MCP: echo-http|mcp:echo-http/i);

    await agent.disableMcpServer("echo-http");
    await expect(agent.mcpServerCard("echo-http")).toContainText(/已禁用|disabled/i);

    await agent.restartMcpServer("echo-http");
    await expect(agent.mcpServerCard("echo-http")).toContainText(/正常|ok/i);
  });
});
