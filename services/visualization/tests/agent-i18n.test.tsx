import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";

import { LocaleSwitch } from "@/app/agent/_components/locale-switch";
import { UntrustedBadge } from "@/app/agent/_components/untrusted-badge";
import { AgentI18nProvider, useAgentI18n } from "@/app/agent/_i18n/provider";

function SampleLabel() {
  const { t } = useAgentI18n();
  return <div>{t("workspace.newSession")}</div>;
}

describe("agent i18n", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("uses the provided default locale", () => {
    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <SampleLabel />
      </AgentI18nProvider>
    );

    expect(screen.getByText("新建会话")).toBeInTheDocument();
  });

  it("switches locale immediately from the selector", async () => {
    const user = userEvent.setup();

    render(
      <AgentI18nProvider defaultLocale="zh-CN">
        <LocaleSwitch />
        <SampleLabel />
      </AgentI18nProvider>
    );

    await user.selectOptions(screen.getByTestId("agent-locale-select"), "en-US");

    expect(screen.getByText("New session")).toBeInTheDocument();
  });

  it("formats trust labels with translated text", () => {
    render(
      <AgentI18nProvider defaultLocale="en-US">
        <UntrustedBadge trustLevel="mcp:echo" />
      </AgentI18nProvider>
    );

    expect(screen.getByText("MCP: echo")).toBeInTheDocument();
  });
});
