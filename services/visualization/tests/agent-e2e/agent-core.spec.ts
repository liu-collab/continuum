import { expect, test } from "@playwright/test";

import { AgentPage } from "./agent-page";

test.describe("agent core", () => {
  test("covers session bootstrap, messaging, file preview, prompt inspector, and session management", async ({
    page,
  }) => {
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

    const sessionCountBefore = await agent.sessionRenameButtons().count();
    await agent.createNewSession();
    await expect(agent.sessionRenameButtons()).toHaveCount(sessionCountBefore + 1);

    await agent.renameFirstSession("手工验收会话");
    await agent.deleteSessionByTitle("手工验收会话");
  });
});
