import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { agentWorkspaceMock } = vi.hoisted(() => ({
  agentWorkspaceMock: vi.fn()
}));

vi.mock("@/app/agent/_components/agent-workspace", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");

  return {
    AgentWorkspace: agentWorkspaceMock.mockImplementation(({ sessionId }: { sessionId?: string }) =>
      ReactModule.createElement("div", { "data-testid": "agent-workspace" }, sessionId ?? "new-session")
    )
  };
});

import AgentLayout from "@/app/agent/layout";
import AgentEntryPage from "@/app/agent/page";
import AgentSessionPage from "@/app/agent/[sessionId]/page";

describe("agent route pages", () => {
  it("renders the agent workspace for the entry route without parsing pathname", () => {
    render(<AgentLayout><AgentEntryPage /></AgentLayout>);

    expect(screen.getByTestId("agent-workspace")).toHaveTextContent("new-session");
    expect(agentWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: undefined }),
      undefined
    );
  });

  it("passes route params to the agent workspace for session routes", async () => {
    const element = await AgentSessionPage({
      params: Promise.resolve({ sessionId: "session-123" })
    });

    render(<AgentLayout>{element}</AgentLayout>);

    expect(screen.getByTestId("agent-workspace")).toHaveTextContent("session-123");
    expect(agentWorkspaceMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ sessionId: "session-123" }),
      undefined
    );
  });
});
