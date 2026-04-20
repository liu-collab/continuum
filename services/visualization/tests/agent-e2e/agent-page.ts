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

  connectionState() {
    return this.page.getByTestId("agent-connection-state");
  }

  async expectConnected() {
    await expect(this.connectionState()).toHaveText(/open|connecting|reconnecting|在线|连接中|重连中|online/);
  }

  async expectReadyToSend() {
    await expect(this.connectionState()).toHaveText(/open|在线|online/);
    await expect(this.page.getByTestId("agent-input")).toBeEnabled();
    await expect(this.page.getByTestId("send-message")).toBeDisabled();
  }

  async waitForConnectedAfterRestart(timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const connection = this.page.getByTestId("agent-connection-state");
      if (await connection.count()) {
        const text = (await connection.first().textContent()) ?? "";
        if (/open|connecting|reconnecting|在线|连接中|重连中|online/.test(text)) {
          return;
        }
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
    await this.page.getByRole("button", { name: /查看 prompt|View Prompt/i }).last().click();
    await expect(this.page.getByText(/Prompt Inspector|Prompt 检查/i)).toBeVisible();
  }

  async closePromptInspector() {
    await this.page.getByTestId("prompt-inspector-close").click();
    await expect(this.page.getByText(/Prompt Inspector|Prompt 检查/i)).toHaveCount(0);
  }

  async switchMemoryMode(value: "workspace_only" | "workspace_plus_global") {
    await this.page.getByTestId("memory-mode-select").selectOption(value);
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

  mcpPanel() {
    return this.page.getByTestId("mcp-panel");
  }

  async expectMcpServerVisible(name: string) {
    await expect(this.mcpPanel()).toContainText(name);
  }

  mcpServerCard(name: string) {
    return this.page.getByTestId(`mcp-server-${name}`);
  }

  async restartMcpServer(name: string) {
    await this.mcpServerCard(name).getByRole("button", { name: /重启|Restart/i }).click();
  }

  async disableMcpServer(name: string) {
    await this.mcpServerCard(name).getByRole("button", { name: /禁用|Disable/i }).click();
  }

  async expectOfflineState() {
    await expect(this.page.getByTestId("agent-offline-state")).toBeVisible();
  }

  async expectRuntimeDependencyState(text: RegExp | string) {
    const dependencyCard = this.page.getByTestId("agent-dependency-card");
    await expect(dependencyCard).toContainText(text);
  }

  async createNewSession() {
    await this.page.getByRole("button", { name: /新建会话|New Session/i }).click();
  }

  async switchLocale(locale: "zh-CN" | "en-US") {
    await this.page.getByTestId("agent-locale-select").selectOption(locale);
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

  sessionRenameButtons() {
    return this.page.getByLabel(/重命名会话|rename session/i);
  }

  sessionDeleteButtons() {
    return this.page.getByLabel(/删除会话|delete session/i);
  }

  sessionCardByTitle(title: string): Locator {
    return this.page.getByTestId(/^session-card-/).filter({ hasText: title }).first();
  }

  async renameFirstSession(title: string) {
    const renameButton = this.sessionRenameButtons().first();
    const card = renameButton.locator("..").locator("..");
    await renameButton.click();
    const renameInput = card.locator("form input");
    await expect(renameInput).toBeVisible();
    await renameInput.fill(title);
    await renameInput.press("Enter");
    await expect(this.page.getByText(title)).toBeVisible();
  }

  async deleteSessionByTitle(title: string) {
    const card = this.sessionCardByTitle(title);
    await card.getByLabel(/删除会话|delete session/i).click();
    await expect(this.page.getByText(title)).toHaveCount(0);
  }

  async openSessionByTitle(title: string) {
    await this.sessionCardByTitle(title).getByRole("button").first().click();
  }

  async waitForSessionReady(title?: string) {
    if (title) {
      await this.expectSessionSelected(title);
    }
    await expect(this.page.getByTestId("agent-input")).toBeVisible();
    await expect(this.connectionState()).toHaveText(/open|在线|online/);
    await expect(this.page.getByTestId("agent-input")).toBeEnabled();
  }

  async expectSessionSelected(title: string) {
    await expect(this.sessionCardByTitle(title)).toHaveClass(/border-accent/);
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

  async expectSessionError(text: RegExp | string) {
    await expect(this.page.getByTestId("agent-session-error")).toContainText(text);
  }

  async expectInjectionOrEmptyState() {
    const injectionSummary = this.page.getByTestId(/injection-summary-/).last();
    const emptyInjectionState = this.page.getByRole("heading", {
      name: /当前轮次没有注入块|No injection/i,
    });

    if (await injectionSummary.count()) {
      await expect(injectionSummary).toBeVisible();
      return;
    }

    await expect(emptyInjectionState).toBeVisible();
  }

  async openRunsPageForTrace(traceId: string) {
    await this.page.goto(`/runs?trace_id=${encodeURIComponent(traceId)}`);
  }
}
