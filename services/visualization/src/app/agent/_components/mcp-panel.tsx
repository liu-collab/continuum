"use client";

import React from "react";

import { StatusBadge } from "@/components/status-badge";

import { useAgentI18n } from "@/lib/i18n/agent/provider";
import type { MnaMcpServerStatus, MnaMcpTool } from "../_lib/openapi-types";

type McpPanelProps = {
  servers: MnaMcpServerStatus[];
  tools: MnaMcpTool[];
  onRestart(name: string): void;
  onDisable(name: string): void;
};

export function McpPanel({ servers, tools, onRestart, onDisable }: McpPanelProps) {
  const { formatMcpStateLabel, t } = useAgentI18n();

  return (
    <div data-testid="mcp-panel" className="panel">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-medium text-foreground">{t("mcpPanel.title")}</div>
      </div>
      <div className="space-y-3 px-4 py-3">
        {servers.length === 0 ? (
          <div className="border border-dashed bg-surface-muted/40 px-3 py-4 text-center text-xs text-muted-foreground" style={{ borderRadius: "var(--radius-lg)" }}>
            {t("mcpPanel.empty")}
          </div>
        ) : (
          servers.map((server) => (
            <div
              key={server.name}
              data-testid={`mcp-server-${server.name}`}
              className="record-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">{server.name}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {server.transport} · {t("mcpPanel.toolCount", { count: server.tool_count })}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <StatusBadge
                    tone={server.state === "ok" ? "success" : server.state === "disabled" ? "warning" : "danger"}
                  >
                    {formatMcpStateLabel(server.state)}
                  </StatusBadge>
                </div>
              </div>
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={() => onRestart(server.name)}
                  className="button-pearl-capsule !min-h-8 !px-3 !py-1"
                >
                  {t("mcpPanel.restart")}
                </button>
                <button
                  type="button"
                  onClick={() => onDisable(server.name)}
                  className="button-pearl-capsule !min-h-8 !px-3 !py-1"
                >
                  {t("mcpPanel.disable")}
                </button>
              </div>
              {server.last_error ? (
                <div className="mt-2 text-xs leading-5 text-rose-700">{server.last_error}</div>
              ) : null}
            </div>
          ))
        )}
        {tools.length > 0 ? (
          <div className="record-card">
            <div className="section-kicker">
              {t("mcpPanel.tools")}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tools.map((tool) => (
                <StatusBadge key={`${tool.server}:${tool.name}`} tone="neutral">
                  {tool.server}:{tool.name}
                </StatusBadge>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
