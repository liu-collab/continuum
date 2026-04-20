import { expect, test } from "@playwright/test";

import { AgentPage } from "./agent-page";
import { restartRuntime, stopRuntime, waitForControlState } from "./stack-control";

test.describe("agent refresh control", () => {
  test("refreshes dependency and mcp state without clearing the current workspace", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();
    await agent.sendMessage("刷新前先保留这条消息");
    await agent.expectLatestAssistantContains(/收到|继续回答|已收到/i);
    await agent.expectLatestUserContains("刷新前先保留这条消息");
    await expect(agent.mcpPanel()).toContainText(/echo-http/i);

    await stopRuntime();
    await agent.clickWorkspaceRefresh();
    await agent.expectRuntimeDependencyState(/unavailable|degraded|unknown/i);
    await agent.expectLatestUserContains("刷新前先保留这条消息");

    await restartRuntime();
    await waitForControlState();
    await agent.clickWorkspaceRefresh();
    await expect(agent.mcpPanel()).toContainText(/echo-http/i);
    await agent.expectLatestUserContains("刷新前先保留这条消息");
  });
});
