"use client";

import React from "react";

import { StatusBadge } from "@/components/status-badge";

import { useAgentI18n } from "../_i18n/provider";
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
    <div data-testid="mcp-panel" className="rounded-lg border bg-surface">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-medium text-foreground">{t("mcpPanel.title")}</div>
      </div>
      <div className="space-y-3 px-4 py-3">
        {servers.length === 0 ? (
          <div className="rounded-md border border-dashed bg-surface-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
            {t("mcpPanel.empty")}
          </div>
        ) : (
          servers.map((server) => (
            <div
              key={server.name}
              data-testid={`mcp-server-${server.name}`}
              className="rounded-md border bg-surface-muted/40 px-3 py-2"
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
                  className="rounded-md border bg-surface px-2 py-0.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                >
                  {t("mcpPanel.restart")}
                </button>
                <button
                  type="button"
                  onClick={() => onDisable(server.name)}
                  className="rounded-md border bg-surface px-2 py-0.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
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
          <div className="rounded-md border bg-surface px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
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
