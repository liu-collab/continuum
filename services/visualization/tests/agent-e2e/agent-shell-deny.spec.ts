import { test } from "@playwright/test";

import { AgentPage } from "./agent-page";

test.describe("agent shell deny feedback", () => {
  test("shows blocked_pattern feedback for denied shell commands", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();

    await agent.sendMessage("请执行一个危险命令");
    await agent.expectToolConfirmDialog();
    await agent.allowTool();
    await agent.expectToolConsoleContains(/shell_exec/);
    await agent.expectToolConsoleContains(/blocked_pattern|tool_denied_pattern|拒绝|denied/i);
  });
});
