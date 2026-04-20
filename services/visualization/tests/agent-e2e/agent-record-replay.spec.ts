import { expect, test } from "@playwright/test";

import { AgentPage } from "./agent-page";

test.describe("agent record-replay provider", () => {
  test("replays a deterministic fs_read tool flow", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();

    await agent.sendMessage("请读取 README.md");
    await agent.expectToolConsoleContains(/fs_read/);
    await agent.expectToolConsoleContains(/内置只读|Built-in read|builtin read/i);
    await agent.expectLatestAssistantContains(/README\.md/);
    await expect(page.getByTestId("send-message")).toBeDisabled();
  });
});
