import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "@/app/agent/_components/confirm-dialog";
import { AgentI18nProvider } from "@/app/agent/_i18n/provider";

describe("ConfirmDialog", () => {
  it("renders plan confirmation dialog and emits approve", async () => {
    const user = userEvent.setup();
    const onDecision = vi.fn();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <ConfirmDialog
          pendingConfirm={{
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
          }}
          onDecision={onDecision}
        />
      </AgentI18nProvider>,
    );

    expect(screen.getByTestId("plan-confirm-dialog")).toBeInTheDocument();
    expect(screen.getByText("先做 A，再做 B")).toBeInTheDocument();

    await user.click(screen.getByTestId("plan-confirm-approve"));
    expect(onDecision).toHaveBeenCalledWith("approve");
  });
});
