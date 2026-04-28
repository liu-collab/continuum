import { expect, test } from "@playwright/test";

import { AgentPage } from "./agent-page";
import { waitForLatestRunTrace } from "./stack-control";

test.describe("agent trace binding", () => {
  test("finds the current turn trace in /runs and other visualization pages stay available", async ({ page }) => {
    const agent = new AgentPage(page);

    await agent.goto();
    await agent.expectConnected();

    await agent.sendMessage("请记住，我偏好使用 TypeScript。");
    await agent.expectLatestAssistantContains("TypeScript");
    const latestRun = await waitForLatestRunTrace();
    expect(latestRun.traceId).toBeTruthy();
    const traceId = latestRun.traceId ?? "";

    await expect
      .poll(async () => {
        const response = await page.request.get(`/api/runs?trace_id=${encodeURIComponent(traceId)}`);
        if (!response.ok()) {
          return null;
        }
        const payload = (await response.json()) as {
          selectedTurn?: {
            turn?: {
              traceId?: string;
              turnId?: string;
            };
          } | null;
        };
        return payload.selectedTurn?.turn?.traceId ?? null;
      })
      .toBe(traceId);

    await agent.openRunsPageForTrace(traceId);
    await expect(page.getByRole("heading", { name: "运行轨迹", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "调试标识" })).toHaveValue(traceId);
    await expect(page.getByRole("heading", { name: /运行轨迹 · / })).toBeVisible();

    await page.goto("/memories");
    await expect(page.getByRole("heading", { name: "记忆目录", exact: true })).toBeVisible();

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: /运行时指标|诊断/ })).toBeVisible();
  });
});
