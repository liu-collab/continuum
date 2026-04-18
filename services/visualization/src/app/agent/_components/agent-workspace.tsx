"use client";

import { Plus, RefreshCcw } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { StatusBadge } from "@/components/status-badge";

import { useAgentWorkspace } from "../_hooks/use-agent-workspace";
import { ChatPanel } from "./chat-panel";
import { ConfirmDialog } from "./confirm-dialog";
import { CostBar } from "./cost-bar";
import { FileTree } from "./file-tree";
import { FilePreview } from "./file-preview";
import { McpPanel } from "./mcp-panel";
import { MemoryPanel } from "./memory-panel";
import { ModeSwitch } from "./mode-switch";
import { PromptInspector } from "./prompt-inspector";
import { ProviderSwitch } from "./provider-switch";
import { SessionList } from "./session-list";
import { ToolConsole } from "./tool-console";

type AgentWorkspaceProps = {
  sessionId?: string;
};

export function AgentWorkspace({ sessionId }: AgentWorkspaceProps) {
  const workspace = useAgentWorkspace({ sessionId });

  if (workspace.state.bootstrapStatus !== "ok") {
    return (
      <div className="space-y-6">
        <ErrorState
          title="agent 离线"
          description={
            workspace.state.bootstrapReason ??
            "请先启动 memory-native-agent，然后刷新页面。建议命令：`continuum start`。"
          }
        />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <CostBar metrics={workspace.metrics} turnCount={workspace.state.turns.length} />
          <div className="flex flex-wrap items-center gap-3">
            <ProviderSwitch
              providerId={workspace.dependencyStatus?.provider.id ?? "provider"}
              providerLabel={
                workspace.dependencyStatus
                  ? `${workspace.dependencyStatus.provider.id}:${workspace.dependencyStatus.provider.model}`
                  : "loading"
              }
              model={workspace.dependencyStatus?.provider.model ?? ""}
              onApply={(model) => {
                void workspace.updateProvider(model);
              }}
              onRefresh={() => {
                void Promise.all([workspace.refreshMetrics(), workspace.refreshDependencyStatus()]);
              }}
            />
            <ModeSwitch
              value={workspace.state.session?.memory_mode ?? "workspace_plus_global"}
              onChange={(value) => {
                void workspace.updateMemoryMode(value);
              }}
            />
            <button
              type="button"
              onClick={() => {
                void workspace.createNewSession();
              }}
              className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95"
            >
              <Plus className="h-4 w-4" />
              新建会话
            </button>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
          <div className="space-y-6">
            <section className="rounded-3xl border bg-white/88 p-5 shadow-soft">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Sessions</p>
                  <h2 className="mt-2 text-xl font-semibold text-slate-900">最近会话</h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void workspace.refreshMetrics();
                    void workspace.refreshDependencyStatus();
                    void workspace.refreshMcpState();
                  }}
                  className="rounded-full border p-2 text-slate-600 transition hover:bg-slate-50"
                >
                  <RefreshCcw className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4">
                <SessionList
                  sessions={workspace.state.sessionList}
                  activeSessionId={workspace.state.sessionId}
                  onSelect={(nextSessionId) => {
                    void workspace.openSession(nextSessionId);
                  }}
                  onRename={(session, title) => {
                    if (session.id === workspace.state.sessionId) {
                      void workspace.renameSession(title);
                    }
                  }}
                  onDelete={(session) => {
                    void workspace.deleteSession(session.id);
                  }}
                />
              </div>
            </section>

            <FileTree
              path={workspace.fileTree.path}
              entries={workspace.fileTree.entries}
              selectedFilePath={workspace.selectedFile?.path ?? null}
              onOpenDirectory={(nextPath) => {
                void workspace.refreshFileTree(nextPath);
              }}
              onOpenFile={(filePath) => {
                void workspace.openFile(filePath);
              }}
            />

            {workspace.selectedFile ? <FilePreview path={workspace.selectedFile.path} content={workspace.selectedFile.content} /> : null}
          </div>

          <div className="space-y-6">
            <ChatPanel
              turns={workspace.state.turns}
              connection={workspace.state.connection}
              degraded={workspace.state.degraded}
              activeTaskLabel={workspace.state.activeTask?.label ?? null}
              onSend={(text) => workspace.sendInput(text)}
              onAbort={() => workspace.abortCurrentTurn()}
              onOpenPrompt={(turnId) => {
                void workspace.openPromptInspector(turnId);
              }}
            />
            <ToolConsole turns={workspace.state.turns} />
          </div>

          <div className="space-y-6">
            <MemoryPanel activeTurn={workspace.activeTurn} degraded={workspace.state.degraded} />
            {workspace.dependencyStatus ? (
              <section className="rounded-3xl border bg-white/88 px-5 py-4 shadow-soft">
                <div className="text-sm font-semibold text-slate-900">依赖状态</div>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-500">runtime</span>
                    <StatusBadge
                      tone={workspace.dependencyStatus.runtime.status === "healthy" ? "success" : "warning"}
                    >
                      {String(workspace.dependencyStatus.runtime.status ?? "unknown")}
                    </StatusBadge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-slate-500">provider</span>
                    <StatusBadge tone="neutral">{workspace.dependencyStatus.provider_key}</StatusBadge>
                  </div>
                </div>
              </section>
            ) : (
              <EmptyState title="依赖状态未加载" description="稍后这里会显示 runtime、provider 和 MCP 的整体状态。" />
            )}
            <McpPanel
              servers={workspace.mcpState?.servers ?? []}
              tools={workspace.mcpState?.tools ?? []}
              onRestart={(name) => {
                void workspace.restartMcpServer(name);
              }}
              onDisable={(name) => {
                void workspace.disableMcpServer(name);
              }}
            />
          </div>
        </div>
      </div>

      <ConfirmDialog pendingConfirm={workspace.state.pendingConfirm} onDecision={workspace.confirmTool} />
      <PromptInspector
        open={workspace.promptInspectorOpen}
        payload={workspace.promptInspector}
        onClose={() => workspace.setPromptInspectorOpen(false)}
      />
    </>
  );
}
