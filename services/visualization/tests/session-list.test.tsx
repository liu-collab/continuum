import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SessionList } from "@/app/agent/_components/session-list";
import { AgentI18nProvider } from "@/app/agent/_i18n/provider";
import type { MnaSessionSummary } from "@/app/agent/_lib/openapi-types";

const sessions: MnaSessionSummary[] = [
  {
    id: "session-1",
    workspace_id: "workspace-1",
    title: "会话一",
    memory_mode: "workspace_plus_global",
    locale: "zh-CN",
    created_at: "2026-04-19T00:00:00.000Z",
    last_active_at: "2026-04-19T00:00:00.000Z",
    closed_at: null,
    latest_turn_id: null
  },
  {
    id: "session-2",
    workspace_id: "workspace-1",
    title: "会话二",
    memory_mode: "workspace_only",
    locale: "zh-CN",
    created_at: "2026-04-19T00:00:01.000Z",
    last_active_at: "2026-04-19T00:00:01.000Z",
    closed_at: null,
    latest_turn_id: null
  }
];

function renderSessionList(props?: Partial<React.ComponentProps<typeof SessionList>>) {
  const onSelect = vi.fn();
  const onRename = vi.fn();
  const onDelete = vi.fn();

  render(
    <AgentI18nProvider defaultLocale="zh-CN">
      <SessionList
        sessions={sessions}
        activeSessionId="session-1"
        onSelect={onSelect}
        onRename={onRename}
        onDelete={onDelete}
        {...props}
      />
    </AgentI18nProvider>
  );

  return {
    onSelect,
    onRename,
    onDelete
  };
}

describe("session list", () => {
  it("renames the targeted session without forcing active session coupling", async () => {
    const user = userEvent.setup();
    const { onRename } = renderSessionList();

    await user.click(screen.getAllByLabelText("重命名会话")[1]!);
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "新的会话名");
    await user.keyboard("{Enter}");

    expect(onRename).toHaveBeenCalledWith(sessions[1], "新的会话名");
  });

  it("deletes a session without selecting it first", async () => {
    const user = userEvent.setup();
    const { onDelete, onSelect } = renderSessionList();

    await user.click(screen.getAllByLabelText("删除会话")[1]!);

    expect(onDelete).toHaveBeenCalledWith(sessions[1]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects a session only when clicking the main card area", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderSessionList();

    await user.click(screen.getByRole("button", { name: /会话二/ }));

    expect(onSelect).toHaveBeenCalledWith("session-2");
  });

  it("shows workspace short id instead of the full workspace id", () => {
    renderSessionList({
      sessions: [
        {
          ...sessions[0],
          workspace_id: "550e8400-e29b-41d4-a716-446655440000"
        }
      ]
    });

    expect(screen.getByText("工作区：550e8400")).toBeInTheDocument();
    expect(screen.queryByText("工作区：550e8400-e29b-41d4-a716-446655440000")).not.toBeInTheDocument();
  });

  it("renders current-turn quick actions inside the active session card", () => {
    renderSessionList({
      activeSessionMemoriesHref: "/memories?workspace_id=workspace-1&source_ref=turn-1",
      activeSessionRunsHref: "/runs?turn_id=turn-1",
    });

    expect(screen.getByRole("link", { name: "查看本轮记忆" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看本轮运行" })).toBeInTheDocument();
  });

  it("renders quick actions in the right column while status badges stay on the same row", () => {
    renderSessionList({
      activeSessionMemoriesHref: "/memories?workspace_id=workspace-1&source_ref=turn-1",
      activeSessionRunsHref: "/runs?turn_id=turn-1",
    });

    const actionRail = screen.getByTestId("session-card-action-rail-session-1");
    const statusRow = screen.getByTestId("session-card-status-row-session-1");
    const quickActions = screen.getByTestId("session-card-quick-actions-session-1");
    const renameButton = screen.getAllByLabelText("重命名会话")[0];

    expect(renameButton.parentElement).toBe(actionRail);
    expect(statusRow.parentElement?.nextElementSibling).toContainElement(quickActions);
  });

  it("keeps current-turn memories scoped by source_ref instead of session_id", () => {
    renderSessionList({
      activeSessionMemoriesHref: "/memories?workspace_id=workspace-1&source_ref=turn-1",
      activeSessionRunsHref: "/runs?turn_id=turn-1",
    });

    expect(screen.getByRole("link", { name: "查看本轮记忆" })).toHaveAttribute(
      "href",
      "/memories?workspace_id=workspace-1&source_ref=turn-1",
    );
  });
});
