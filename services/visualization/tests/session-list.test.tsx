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
    user_id: "user-1",
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
    user_id: "user-1",
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
});
