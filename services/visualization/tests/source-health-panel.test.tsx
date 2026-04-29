import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SourceHealthPanel } from "@/components/source-health-panel";
import { AppI18nProvider } from "@/lib/i18n/client";

describe("source health panel", () => {
  it("renders service health and dependencies separately", () => {
    render(
      <AppI18nProvider defaultLocale="zh-CN">
        <SourceHealthPanel
          health={{
          liveness: {
            status: "ok",
            checkedAt: "2026-04-15T12:00:00.000Z"
          },
          readiness: {
            status: "ready",
            checkedAt: "2026-04-15T12:00:00.000Z",
            summary: "ready"
          },
          service: {
            name: "visualization",
            summary: "service healthy"
          },
          dependencies: [
            {
              name: "runtime_api",
              label: "Runtime observe API",
              kind: "dependency",
              status: "timeout",
              checkedAt: "2026-04-15T12:00:00.000Z",
              lastCheckedAt: "2026-04-15T12:00:00.000Z",
              lastOkAt: null,
              lastError: "timeout",
              responseTimeMs: 2000,
              detail: "timeout",
              activeConnections: 2,
              connectionLimit: 5
            }
          ]
          }}
        />
      </AppI18nProvider>
    );

    expect(screen.getByText("服务存活")).toBeInTheDocument();
    expect(screen.getByText("服务就绪")).toBeInTheDocument();
    expect(screen.getByText("外部依赖")).toBeInTheDocument();
    expect(screen.getByText("Runtime observe API")).toBeInTheDocument();
    expect(screen.getByText("从未成功连接")).toBeInTheDocument();
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
  });
});
