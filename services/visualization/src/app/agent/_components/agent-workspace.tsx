"use client";

import React, { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { cn } from "@/lib/utils";

import { useAgentI18n } from "@/lib/i18n/agent/provider";
import { useAgentWorkspace } from "../_hooks/use-agent-workspace";
import { formatProviderKindLabel } from "../_lib/provider-kind";
import { ChatPanel } from "./chat-panel";
import { ConfirmDialog } from "./confirm-dialog";
import { FilePreview } from "./file-preview";
import { FileTree } from "./file-tree";
import { PromptInspector } from "./prompt-inspector";
import { SessionList } from "./session-list";
import { SettingsModal } from "./settings-modal";

type AgentWorkspaceProps = {
  sessionId?: string;
};

const PANEL_HEIGHT_CLASS = "min-h-0 xl:h-full";

export function AgentWorkspace({ sessionId }: AgentWorkspaceProps) {
  const { locale, t } = useAgentI18n();
  const workspace = useAgentWorkspace({ sessionId, uiLocale: locale });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMode, setSettingsMode] = useState<"runtime" | "setup">("runtime");
  const [setupPrompted, setSetupPrompted] = useState(false);
  const bootstrapDescription =
    workspace.state.bootstrapReason ??
    (workspace.state.bootstrapStatus === "loading"
      ? t("workspace.bootstrap.loading")
      : resolveBootstrapDescription(workspace.state.bootstrapStatus, t));
  const currentTurnRunsHref = workspace.activeTurn?.turnId
    ? `/runs?turn_id=${encodeURIComponent(workspace.activeTurn.turnId)}`
    : null;
  const providerLabel = workspace.dependencyStatus && workspace.dependencyStatus.provider.id !== "not-configured"
    ? `${formatProviderKindLabel(workspace.dependencyStatus.provider.id)} · ${workspace.dependencyStatus.provider.model}`
    : null;
  const currentTurnMemoriesHref = buildMemoriesHref({
    workspaceId: workspace.state.session?.workspace_id ?? null,
    taskId: workspace.state.activeTask?.taskId ?? null,
    turnId: workspace.activeTurn?.turnId ?? null
  });

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("settings") === "governance") {
      setSettingsMode("runtime");
      setSettingsOpen(true);
    }
  }, []);

  useEffect(() => {
    if (
      setupPrompted ||
      workspace.state.bootstrapStatus !== "ok" ||
      workspace.agentConfig?.provider.kind !== "not-configured"
    ) {
      return;
    }

    setSettingsMode("setup");
    setSettingsOpen(true);
    setSetupPrompted(true);
  }, [setupPrompted, workspace.agentConfig?.provider.kind, workspace.state.bootstrapStatus]);

  if (workspace.state.bootstrapStatus === "loading") {
    return (
      <div className="space-y-6">
        <EmptyState
          testId="agent-bootstrap-loading-state"
          title={t("workspace.bootstrap.loadingTitle")}
          description={bootstrapDescription}
        />
      </div>
    );
  }

  if (workspace.state.bootstrapStatus !== "ok") {
    return (
      <div className="space-y-6">
        <ErrorState
          testId="agent-offline-state"
          title={t("workspace.offlineTitle")}
          description={bootstrapDescription}
        />
      </div>
    );
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        <div
          data-testid="agent-workspace-layout"
          className={cn(
            "grid h-full min-h-0 flex-1 grid-rows-[minmax(0,1fr)_minmax(0,0.78fr)] gap-4 overflow-hidden xl:grid-cols-[22rem_minmax(0,1fr)] xl:grid-rows-[minmax(0,1fr)] xl:gap-6"
          )}
        >
          <section
            data-testid="agent-sidebar-column"
            className={`panel order-2 flex ${PANEL_HEIGHT_CLASS} max-h-none flex-col overflow-hidden xl:order-1`}
          >
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="text-sm font-semibold text-foreground">{t("workspace.sessionsTitle")}</div>
              <button
                type="button"
                onClick={() => {
                  void workspace.createNewSession();
                }}
                className="btn-primary"
              >
                <Plus className="h-4 w-4" />
                {t("workspace.newSession")}
              </button>
            </div>
            <div className="agent-session-scroll min-h-0 flex-1 overflow-y-scroll p-3">
              <SessionList
                sessions={workspace.state.sessionList}
                workspaces={workspace.workspaceList}
                activeSessionId={workspace.state.sessionId}
                activeSessionMemoriesHref={currentTurnMemoriesHref}
                activeSessionRunsHref={currentTurnRunsHref}
                onSelect={(nextSessionId) => {
                  void workspace.openSession(nextSessionId);
                }}
                onDelete={(session) => {
                  void workspace.deleteSession(session.id);
                }}
              />

              <div className="mt-4">
                <FileTree
                  path={workspace.fileTree.path}
                  entries={workspace.fileTree.entries}
                  workspaces={workspace.workspaceList}
                  selectedWorkspaceId={workspace.selectedWorkspaceId}
                  selectedFilePath={workspace.selectedFilePath ?? null}
                  onPickWorkspace={() => workspace.pickWorkspace().then(() => undefined)}
                  onClearWorkspace={() => workspace.selectWorkspace(null)}
                  onOpenDirectory={(nextPath) => {
                    return workspace.refreshFileTree(nextPath);
                  }}
                  onOpenFile={(filePath) => {
                    return workspace.openFile(filePath);
                  }}
                />
              </div>

              {workspace.selectedFile ? (
                <div className="mt-4">
                  <FilePreview path={workspace.selectedFile.path} content={workspace.selectedFile.content} />
                </div>
              ) : null}
            </div>
          </section>

          <div
            data-testid="agent-chat-column"
            className="order-1 flex min-h-0 flex-col gap-4 overflow-hidden xl:order-2"
          >
            {workspace.state.replayGapDetected ? (
              <ErrorState
                testId="agent-replay-gap"
                title={t("workspace.replayGapTitle")}
                description={t("workspace.replayGapDescription")}
              />
            ) : null}
            <ChatPanel
              turns={workspace.state.turns}
              connection={workspace.state.connection}
              degraded={workspace.state.degraded}
              activeTaskLabel={workspace.state.activeTask?.label ?? null}
              providerLabel={providerLabel}
              dependencyStatus={workspace.dependencyStatus}
              skills={workspace.skillList}
              onSend={(text) => workspace.sendInput(text)}
              onAbort={() => workspace.abortCurrentTurn()}
              onOpenPrompt={(turnId) => {
                void workspace.openPromptInspector(turnId);
              }}
              onCheckModels={async () => {
                await Promise.allSettled([
                  workspace.checkEmbeddings(),
                  workspace.checkMemoryLlm(),
                ]);
              }}
              onOpenSettings={() => {
                setSettingsMode(workspace.agentConfig?.provider.kind === "not-configured" ? "setup" : "runtime");
                setSettingsOpen(true);
              }}
            />
          </div>
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        setupWizard={settingsMode === "setup" && workspace.agentConfig?.provider.kind === "not-configured"}
        config={workspace.agentConfig}
        memoryModelHealth={workspace.dependencyStatus?.runtime.memory_llm ?? null}
        memoryMode={workspace.state.session?.memory_mode ?? "workspace_plus_global"}
        onMemoryModeChange={(value) => {
          void workspace.updateMemoryMode(value);
        }}
        onSaveRuntime={(payload) => {
          return workspace.updateRuntimeConfig(payload);
        }}
        onListProviderModels={(payload) => {
          return workspace.listProviderModels(payload);
        }}
      />

      <ConfirmDialog pendingConfirm={workspace.state.pendingConfirm} onDecision={workspace.confirmTool} />
      <PromptInspector
        open={workspace.promptInspectorOpen}
        payload={workspace.promptInspector}
        onClose={() => workspace.setPromptInspectorOpen(false)}
      />
    </>
  );
}

function buildMemoriesHref(input: {
  workspaceId: string | null;
  taskId: string | null;
  turnId: string | null;
}) {
  const params = new URLSearchParams();
  if (input.workspaceId) {
    params.set("workspace_id", input.workspaceId);
  }
  if (input.taskId) {
    params.set("task_id", input.taskId);
  }
  if (input.turnId) {
    params.set("source_ref", input.turnId);
  }
  if (!params.toString()) {
    return null;
  }
  return `/memories?${params.toString()}`;
}

function resolveBootstrapDescription(
  status: ReturnType<typeof useAgentWorkspace>["state"]["bootstrapStatus"],
  t: (key: string) => string
) {
  switch (status) {
    case "mna_not_running":
      return t("workspace.bootstrap.mna_not_running");
    case "token_missing":
      return t("workspace.bootstrap.token_missing");
    case "token_invalid":
      return t("workspace.bootstrap.token_invalid");
    default:
      return t("workspace.offlineDescription");
  }
}
