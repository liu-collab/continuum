import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach } from "vitest";

import { UntrustedBadge } from "@/app/agent/_components/untrusted-badge";
import { AppLocaleSwitch } from "@/components/app-locale-switch";
import { AppI18nProvider, useAppI18n } from "@/lib/i18n/client";
import { AgentI18nProvider, useAgentI18n } from "@/lib/i18n/agent/provider";

function SampleLabel() {
  const { t } = useAgentI18n();
  return <div>{t("workspace.newSession")}</div>;
}

function GlobalApplyLabel() {
  const { t } = useAppI18n();
  return <div>{t("common.apply")}</div>;
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
      <AppI18nProvider defaultLocale="zh-CN">
        <AgentI18nProvider>
          <AppLocaleSwitch />
          <SampleLabel />
        </AgentI18nProvider>
      </AppI18nProvider>
    );

    await user.click(screen.getByTestId("app-locale-select"));

    expect(screen.getByText("New session")).toBeInTheDocument();
  });

  it("shares locale state with the global app provider", async () => {
    const user = userEvent.setup();

    render(
      <AppI18nProvider defaultLocale="zh-CN">
        <AgentI18nProvider defaultLocale="en-US">
          <AppLocaleSwitch />
          <SampleLabel />
          <GlobalApplyLabel />
        </AgentI18nProvider>
      </AppI18nProvider>
    );

    expect(screen.getByText("新建会话")).toBeInTheDocument();
    expect(screen.getByText("应用")).toBeInTheDocument();

    await user.click(screen.getByTestId("app-locale-select"));

    expect(screen.getByText("New session")).toBeInTheDocument();
    expect(screen.getByText("Apply")).toBeInTheDocument();
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
