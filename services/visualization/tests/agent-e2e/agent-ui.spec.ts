import { test, expect } from "@playwright/test";

test.describe("agent ui", () => {
  test("can create a session, stream a reply, switch memory mode and show degraded state", async ({ page }) => {
    await page.goto("/agent");

    await expect(page.getByTestId("agent-connection-state")).toHaveAttribute(
      "data-state",
      /open|connecting|reconnecting|在线|连接中|重连中|online/,
    );
    await page.getByTestId("agent-input").fill("请记住，我偏好使用 TypeScript。");
    await page.getByTestId("send-message").click();

    await expect(page.getByTestId(/assistant-message-/).last()).toContainText("TypeScript");

    await page.getByTestId("memory-mode-select").selectOption("workspace_only");
    await page.getByTestId("agent-input").fill("我偏好什么语言？");
    await page.getByTestId("send-message").click();

    await expect(page.getByTestId(/assistant-message-/).last()).toContainText("当前没有恢复到相关偏好");
  });
});
