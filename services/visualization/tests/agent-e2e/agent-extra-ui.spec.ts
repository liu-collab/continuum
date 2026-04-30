import { expect, test } from "@playwright/test";

import { AgentPage } from "./agent-page";
import { triggerReplayGap, triggerSessionError } from "./stack-control";

test.describe("agent extra ui flows", () => {
  test("switches locale without clearing session content", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();
    await agent.sendMessage("请记住，我偏好使用 TypeScript。");
    await agent.expectLatestAssistantContains("TypeScript");

    await agent.switchLocale("en-US");
    await expect(page.getByRole("button", { name: /New session/i })).toBeVisible();
    await expect(page.getByTestId(/assistant-message-/).last()).toContainText("TypeScript");

    await page.reload();
    await expect(page.getByRole("button", { name: /New session/i })).toBeVisible();
    await expect(page.getByTestId(/assistant-message-/).last()).toContainText("TypeScript");
  });

  test("switches provider model and refreshes dependency status", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();

    await agent.applyProviderModel("test-model-v2");
    await agent.refreshProviderStatus();
    await expect(page.getByTestId("provider-label")).toContainText("ollama:test-model-v2");

    await agent.sendMessage("切换模型后继续回答");
    await agent.expectLatestAssistantContains(/收到|继续回答|已收到/i);
    await agent.openPromptInspector();
    await expect(page.getByText("ollama / test-model-v2")).toBeVisible();
  });

  test("supports abort and keyboard shortcuts in the input", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();

    await agent.typeMessage("第一行");
    await agent.pressInputShortcut("Shift+Enter");
    await agent.pressInputShortcut("a");
    await expect(page.getByTestId("agent-input")).toHaveValue("第一行\na");

    await agent.pressInputShortcut("Enter");
    await agent.expectLatestAssistantContains(/收到/i);

    await agent.typeMessage("第二轮使用 Escape 中止");
    await agent.pressInputShortcut("Enter");
    await expect(page.getByTestId("abort-turn")).toBeEnabled();
    await agent.pressInputShortcut("Escape");
    await expect(page.getByText(/已中止|Aborted/)).toBeVisible();
  });

  test("switches sessions and supports deeplink restore", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();
    await agent.sendMessage("这是会话一");
    await agent.expectLatestAssistantContains(/收到/i);
    const firstSessionId = await agent.currentSessionId();
    expect(firstSessionId).toBeTruthy();

    await agent.createNewSession();
    const secondSessionId = await agent.currentSessionId();
    expect(secondSessionId).toBeTruthy();
    await expect(page.getByRole("heading", { name: /还没有对话|No conversation/i })).toBeVisible();
    await agent.sendMessage("这是会话二");
    await agent.expectLatestAssistantContains(/收到/i);
    await agent.expectLatestUserContains("这是会话二");

    await agent.openSessionById(firstSessionId ?? "");
    await agent.waitForSessionReady();
    await agent.expectSessionSelectedById(firstSessionId ?? "");
    await agent.expectLatestUserContains("这是会话一");
    await agent.sendMessage("切回会话一后继续");
    await agent.expectLatestAssistantContains(/收到|继续回答|已收到/i);

    await agent.gotoSession(firstSessionId ?? "");
    await agent.waitForSessionReady();
    await agent.expectAnyUserMessageContains("这是会话一");
    await agent.expectAnyUserMessageContains("切回会话一后继续");
    await agent.sendMessage("深链恢复后继续");
    await agent.expectLatestAssistantContains(/收到|继续回答|已收到/i);
  });

  test("navigates file tree into nested directories", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();

    await agent.openDirectory("docs");
    await agent.expectFileTreePath(/docs/);
    await page.getByRole("button", { name: /guide\.md/i }).click();
    await expect(page.getByTestId("file-preview")).toContainText("guide.md");
  });

  test("shows replay gap without breaking the page", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();

    const sessionId = await agent.currentSessionId();
    expect(sessionId).toBeTruthy();

    await triggerReplayGap(sessionId ?? "");
    await agent.expectReplayGap();

    await agent.sendMessage("gap 后继续回答");
    await agent.expectLatestAssistantContains(/收到|继续回答|已收到/i);
  });

  test("keeps session errors out of the top banner without breaking the page", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();

    const sessionId = await agent.currentSessionId();
    expect(sessionId).toBeTruthy();

    await triggerSessionError(sessionId ?? "");
    await agent.expectNoSessionErrorBanner();
    await expect(page.getByTestId("agent-input")).toBeVisible();

    await agent.sendMessage("错误后继续回答");
    await agent.expectLatestAssistantContains(/收到|继续回答|已收到/i);
  });
});
