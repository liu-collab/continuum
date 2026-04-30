import { expect, test } from "@playwright/test";

import { AgentPage } from "./agent-page";
import { restartMna, restartRuntime, stopMna, stopRuntime, waitForControlState } from "./stack-control";

test.describe("agent degrade and recovery", () => {
  test("degrades when runtime is down and recovers after restart", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();

    await stopRuntime();
    await page.reload();
    await agent.expectConnected();
    await agent.sendMessage("runtime 挂掉后继续回答");
    await agent.expectLatestAssistantContains(/收到|继续回答|已收到/i);
    await expect(page.getByTestId("agent-degraded-banner")).toBeVisible();

    await restartRuntime();
    await waitForControlState();
    await page.reload();
    await agent.expectConnected();
    await agent.refreshProviderStatus();
    await agent.sendMessage("runtime 恢复后继续回答");
    await agent.expectLatestAssistantContains(/收到|继续回答|已收到/i);
  });

  test("shows offline state when mna is down and recovers after restart", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();

    await stopMna();
    await page.reload();
    await agent.expectOfflineState();

    await restartMna();
    await waitForControlState();
    await agent.waitForConnectedAfterRestart();
    await agent.sendMessage("恢复后继续回答");
    await agent.expectLatestAssistantContains(/收到|继续回答|已收到/i);
  });
});
