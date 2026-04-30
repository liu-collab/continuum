import { expect, type Locator, type Page } from "@playwright/test";

export class AgentPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto("/agent");
  }

  async gotoSession(sessionId: string) {
    await this.page.goto(`/agent/${sessionId}`);
  }

  async currentSessionId() {
    await this.page.waitForURL(/\/agent\/[^/]+$/);
    const match = this.page.url().match(/\/agent\/([^/?#]+)/);
    return match?.[1] ?? null;
  }

  async expectConnected() {
    await expect(this.page.getByTestId("agent-offline-state")).toHaveCount(0);
    await expect(this.page.getByTestId("agent-input")).toBeVisible();
  }

  async expectReadyToSend() {
    await expect(this.page.getByTestId("agent-offline-state")).toHaveCount(0);
    await expect(this.page.getByTestId("agent-input")).toBeEnabled();
    await expect(this.page.getByTestId("send-message")).toBeDisabled();
  }

  async waitForConnectedAfterRestart(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await this.page.getByTestId("agent-input").count()) {
        await this.expectConnected();
        return;
      }

      await this.page.reload();
      await this.page.waitForLoadState("domcontentloaded");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    await this.expectConnected();
  }

  async sendMessage(text: string) {
    await this.expectReadyToSend();
    await this.page.getByTestId("agent-input").fill(text);
    await expect(this.page.getByTestId("send-message")).toBeEnabled();
    await this.page.getByTestId("send-message").click();
  }

  async typeMessage(text: string) {
    await this.page.getByTestId("agent-input").fill(text);
  }

  async pressInputShortcut(key: string) {
    await this.page.getByTestId("agent-input").press(key);
  }

  assistantMessages() {
    return this.page.getByTestId(/assistant-message-/);
  }

  userMessages() {
    return this.page.getByTestId(/user-message-/);
  }

  async expectLatestAssistantContains(text: RegExp | string) {
    await expect(this.assistantMessages().last()).toContainText(text);
  }

  async expectLatestUserContains(text: RegExp | string) {
    await expect(this.userMessages().last()).toContainText(text);
  }

  async expectAnyUserMessageContains(text: RegExp | string) {
    await expect(this.userMessages().filter({ hasText: text }).first()).toBeVisible();
  }

  async openPromptInspector() {
    await this.page.getByRole("button", { name: /查看提示词|View Prompt/i }).last().click();
    await expect(this.page.getByText(/Prompt Inspector|提示词检查/i)).toBeVisible();
  }

  async closePromptInspector() {
    await this.page.getByTestId("prompt-inspector-close").click();
    await expect(this.page.getByText(/Prompt Inspector|提示词检查/i)).toHaveCount(0);
  }

  async switchMemoryMode(value: "workspace_only" | "workspace_plus_global") {
    const label = value === "workspace_only" ? /仅工作区|Workspace only/i : /工作区 \+ 全局|Workspace \+ Global/i;
    await this.page.getByTestId("memory-mode-select").click();
    await this.page.getByRole("option", { name: label }).click();
  }

  async openReadmePreview() {
    const readmeNode = this.page.getByRole("button", { name: /README\.md/i }).first();
    await expect(readmeNode).toBeVisible();
    await readmeNode.click();
    await expect(this.page.getByTestId("file-preview")).toBeVisible();
  }

  async expectToolConfirmDialog() {
    await expect(this.page.getByTestId("tool-confirm-dialog")).toBeVisible();
  }

  async allowTool() {
    await this.page.getByTestId("confirm-allow").click();
  }

  async denyTool() {
    await this.page.getByTestId("confirm-deny").click();
  }

  async allowToolForSession() {
    await this.page.getByTestId("confirm-allow-session").click();
  }

  toolCallBlocks() {
    return this.page.getByTestId(/tool-call-/);
  }

  async expectToolConsoleContains(text: RegExp | string) {
    await expect(this.toolCallBlocks().last()).toContainText(text);
  }

  async expectOfflineState() {
    await expect(this.page.getByTestId("agent-offline-state")).toBeVisible();
  }

  async createNewSession() {
    await this.page.getByRole("button", { name: /新建会话|New Session/i }).click();
  }

  async switchLocale(locale: "zh-CN" | "en-US") {
    const localeSwitch = this.page.getByTestId("app-locale-select");
    const targetLabel = locale === "zh-CN" ? "ZH" : "EN";
    const currentLabel = await localeSwitch.textContent();
    if (!currentLabel?.includes(targetLabel)) {
      await localeSwitch.click();
    }
  }

  async applyProviderModel(model: string) {
    const input = this.page.getByTestId("provider-model-input");
    await input.fill(model);
    await this.page.getByTestId("provider-apply").click();
  }

  async refreshProviderStatus() {
    await this.page.getByTestId("provider-refresh").click();
  }

  async clickWorkspaceRefresh() {
    await this.page
      .locator("section")
      .filter({ has: this.page.getByRole("heading", { name: /最近会话|Recent sessions/i }) })
      .getByRole("button")
      .first()
      .click();
  }

  async abortTurn() {
    await this.page.getByTestId("abort-turn").click();
  }

  sessionDeleteButtons() {
    return this.page.getByLabel(/删除会话|delete session/i);
  }

  sessionCards() {
    return this.page.getByTestId(/^session-card-/);
  }

  activeSessionCard() {
    return this.page.locator('[data-testid^="session-card-"][data-active="true"]').first();
  }

  sessionCardByTitle(title: string): Locator {
    return this.page.getByTestId(/^session-card-/).filter({ hasText: title }).first();
  }

  sessionCardById(sessionId: string): Locator {
    return this.page.getByTestId(`session-card-${sessionId}`);
  }

  async deleteSessionByTitle(title: string) {
    const card = this.sessionCardByTitle(title);
    await card.getByLabel(/删除会话|delete session/i).click();
    await expect(this.page.getByText(title)).toHaveCount(0);
  }

  async deleteActiveSession() {
    const activeCard = this.activeSessionCard();
    const activeCardTestId = await activeCard.getAttribute("data-testid");
    await activeCard.getByLabel(/删除会话|delete session/i).click();
    if (activeCardTestId) {
      await expect(this.page.getByTestId(activeCardTestId)).toHaveCount(0);
    }
  }

  async openSessionByTitle(title: string) {
    await this.sessionCardByTitle(title).getByRole("button").first().click();
  }

  async openSessionById(sessionId: string) {
    await this.sessionCardById(sessionId).getByRole("button").first().click();
  }

  async waitForSessionReady(title?: string) {
    if (title) {
      await this.expectSessionSelected(title);
    }
    await expect(this.page.getByTestId("agent-input")).toBeVisible();
    await expect(this.page.getByTestId("agent-input")).toBeEnabled();
  }

  async expectSessionSelected(title: string) {
    await expect(this.sessionCardByTitle(title)).toHaveAttribute("data-active", "true");
  }

  async expectSessionSelectedById(sessionId: string) {
    await expect(this.sessionCardById(sessionId)).toHaveAttribute("data-active", "true");
  }

  async openDirectory(name: string) {
    await this.page.getByRole("button", { name: new RegExp(name, "i") }).click();
  }

  async expectFileTreePath(text: RegExp | string) {
    await expect(this.page.getByText(text).first()).toBeVisible();
  }

  async expectReplayGap() {
    await expect(this.page.getByTestId("agent-replay-gap")).toBeVisible();
  }

  async expectNoSessionErrorBanner() {
    await expect(this.page.getByTestId("agent-session-error")).toHaveCount(0);
  }

  async expectInjectionOrEmptyState() {
    const memorySummary = this.page.getByTestId("memory-panel-summary");
    const emptyInjectionState = this.page.getByTestId("memory-panel-empty-state");

    if (await memorySummary.count()) {
      await expect(memorySummary).toBeVisible();
      return;
    }

    await expect(emptyInjectionState).toBeVisible();
  }

  async openRunsPageForTrace(traceId: string) {
    await this.page.goto(`/runs?trace_id=${encodeURIComponent(traceId)}`);
  }
}
