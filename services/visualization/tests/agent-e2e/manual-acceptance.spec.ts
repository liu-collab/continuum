import { expect, test } from "@playwright/test";

import { AgentPage } from "./agent-page";

test.describe("manual acceptance checks", () => {
  test("agent page supports core interaction flow on dev stack", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();

    await agent.expectConnected();
    await expect(page.getByTestId("memory-mode-select")).toBeVisible();
    await expect(page.getByTestId("agent-input")).toBeVisible();

    await agent.sendMessage("请记住，我偏好使用 TypeScript。");

    await agent.expectLatestAssistantContains("TypeScript");
    await agent.expectInjectionOrEmptyState();

    await agent.openPromptInspector();
    await expect(page.getByText(/工具数|Tool count/i)).toBeVisible();
    await agent.closePromptInspector();

    await agent.switchMemoryMode("workspace_only");
    await agent.sendMessage("我偏好什么语言？");

    await agent.expectLatestAssistantContains(/当前没有恢复到相关偏好|没有恢复到相关偏好/);

    await agent.openReadmePreview();
    await expect(page.getByTestId("file-preview")).toContainText("README.md");

    const sessionCountBefore = await agent.sessionCards().count();
    await agent.createNewSession();
    await expect(agent.sessionCards()).toHaveCount(sessionCountBefore + 1);

    await agent.deleteActiveSession();
  });
});
