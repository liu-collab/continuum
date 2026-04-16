import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SourceHealthPanel } from "@/components/source-health-panel";

describe("source health panel", () => {
  it("renders service health and dependencies separately", () => {
    render(
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
              detail: "timeout"
            }
          ]
        }}
      />
    );

    expect(screen.getByText("Service liveness")).toBeInTheDocument();
    expect(screen.getByText("Service readiness")).toBeInTheDocument();
    expect(screen.getByText("External dependencies")).toBeInTheDocument();
    expect(screen.getByText("Runtime observe API")).toBeInTheDocument();
    expect(screen.getByText("Never connected")).toBeInTheDocument();
  });
});
