import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/app/agent/_components/confirm-dialog";
import { AgentI18nProvider } from "@/app/agent/_i18n/provider";
import type { AgentPendingConfirm, AgentPendingPlanConfirm } from "@/app/agent/_lib/event-reducer";

function renderConfirmDialog(
  pendingConfirm: AgentPendingConfirm | AgentPendingPlanConfirm,
  onDecision = vi.fn()
) {
  render(
    <AgentI18nProvider defaultLocale="zh-CN">
      <ConfirmDialog pendingConfirm={pendingConfirm} onDecision={onDecision} />
    </AgentI18nProvider>,
  );

  return onDecision;
}

const toolConfirm = {
  kind: "tool",
  confirmId: "confirm-tool-1",
  callId: "call-1",
  tool: "shell_exec",
  paramsPreview: "pnpm test",
  riskHint: "shell",
} satisfies AgentPendingConfirm;

const planConfirm = {
  kind: "plan",
  confirmId: "confirm-plan-1",
  turnId: "turn-1",
  plan: {
    id: "plan-1",
    goal: "先做 A，再做 B",
    status: "draft",
    steps: [
      {
        id: "step-1",
        title: "先做 A",
        status: "pending",
      },
      {
        id: "step-2",
        title: "再做 B",
        status: "pending",
      },
    ],
  },
} satisfies AgentPendingPlanConfirm;

describe("ConfirmDialog", () => {
  it("renders plan confirmation dialog and emits approve", async () => {
    const user = userEvent.setup();
    const onDecision = renderConfirmDialog(planConfirm);

    expect(screen.getByTestId("plan-confirm-dialog")).toBeInTheDocument();
    expect(screen.getByText("先做 A，再做 B")).toBeInTheDocument();

    await user.click(screen.getByTestId("plan-confirm-approve"));
    expect(onDecision).toHaveBeenCalledWith("approve");
  });

  it.each([
    ["confirm-deny", "deny"],
    ["confirm-allow", "allow"],
    ["confirm-allow-session", "allow_session"],
  ] as const)("emits %s tool decision", async (testId, decision) => {
    const user = userEvent.setup();
    const onDecision = renderConfirmDialog(toolConfirm);

    await user.click(screen.getByTestId(testId));

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith(decision);
  });

  it("focuses the safe tool action first and prevents duplicate decisions", async () => {
    const user = userEvent.setup();
    const onDecision = renderConfirmDialog(toolConfirm);

    expect(screen.getByTestId("confirm-deny")).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.click(screen.getByTestId("confirm-allow"));
    await user.click(screen.getByTestId("confirm-allow-session"));

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith("deny");
    expect(screen.getByTestId("confirm-deny")).toBeDisabled();
    expect(screen.getByTestId("confirm-allow")).toBeDisabled();
    expect(screen.getByTestId("confirm-allow-session")).toBeDisabled();
  });

  it("emits trimmed revision feedback for plan changes", async () => {
    const user = userEvent.setup();
    const onDecision = renderConfirmDialog(planConfirm);

    await user.type(screen.getByTestId("plan-confirm-feedback"), "  请先补充测试  ");
    await user.click(screen.getByTestId("plan-confirm-revise"));

    expect(onDecision).toHaveBeenCalledWith("revise", "请先补充测试");
  });

  it.each([
    ["backdrop", async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByTestId("tool-confirm-backdrop"))],
    ["close button", async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByTestId("confirm-close"))],
    ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
  ] as const)("dismisses tool confirmation as deny from %s", async (_label, dismiss) => {
    const user = userEvent.setup();
    const onDecision = renderConfirmDialog(toolConfirm);

    await user.click(screen.getByTestId("tool-confirm-dialog"));
    expect(onDecision).not.toHaveBeenCalled();

    await dismiss(user);

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith("deny");
  });

  it.each([
    ["backdrop", async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByTestId("plan-confirm-backdrop"))],
    ["close button", async (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByTestId("plan-confirm-close"))],
    ["Escape", async (user: ReturnType<typeof userEvent.setup>) => user.keyboard("{Escape}")],
  ] as const)("dismisses plan confirmation as cancel from %s", async (_label, dismiss) => {
    const user = userEvent.setup();
    const onDecision = renderConfirmDialog(planConfirm);

    await user.click(screen.getByTestId("plan-confirm-dialog"));
    expect(onDecision).not.toHaveBeenCalled();

    await dismiss(user);

    expect(onDecision).toHaveBeenCalledTimes(1);
    expect(onDecision).toHaveBeenCalledWith("cancel");
  });
});
