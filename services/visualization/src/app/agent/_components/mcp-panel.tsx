"use client";

import { Cable } from "lucide-react";

import { StatusBadge } from "@/components/status-badge";

import type { MnaMcpServerStatus, MnaMcpTool } from "../_lib/openapi-types";

type McpPanelProps = {
  servers: MnaMcpServerStatus[];
  tools: MnaMcpTool[];
  onRestart(name: string): void;
  onDisable(name: string): void;
};

export function McpPanel({ servers, tools, onRestart, onDisable }: McpPanelProps) {
  return (
    <div className="rounded-3xl border bg-white/85 shadow-soft">
      <div className="flex items-center gap-2 border-b px-5 py-4">
        <Cable className="h-4 w-4 text-accent" />
        <div>
          <div className="text-sm font-semibold text-slate-900">MCP Servers</div>
          <div className="text-xs text-slate-500">查看当前连接状态，并直接执行 restart 或 disable。</div>
        </div>
      </div>
      <div className="space-y-4 px-5 py-4">
        {servers.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-white/70 px-4 py-5 text-sm text-slate-500">
            当前没有配置 MCP server。
          </div>
        ) : (
          servers.map((server) => (
            <div key={server.name} className="rounded-2xl border bg-slate-50/80 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{server.name}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {server.transport} · tools {server.tool_count}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={server.state === "ok" ? "success" : server.state === "disabled" ? "warning" : "danger"}>
                    {server.state}
                  </StatusBadge>
                  <button
                    type="button"
                    onClick={() => onRestart(server.name)}
                    className="rounded-full border px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-white"
                  >
                    restart
                  </button>
                  <button
                    type="button"
                    onClick={() => onDisable(server.name)}
                    className="rounded-full border px-3 py-1 text-xs font-semibold text-slate-700 transition hover:bg-white"
                  >
                    disable
                  </button>
                </div>
              </div>
              {server.last_error ? <div className="mt-2 text-xs leading-6 text-rose-700">{server.last_error}</div> : null}
            </div>
          ))
        )}
        {tools.length > 0 ? (
          <div className="rounded-2xl border bg-white px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">exposed tools</div>
            <div className="mt-3 flex flex-wrap gap-2">
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
