"use client";

import React, { useState } from "react";
import { Plus } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";

import { useAgentI18n } from "../_i18n/provider";
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

const PANEL_HEIGHT_CLASS = "h-full min-h-0";

export function AgentWorkspace({ sessionId }: AgentWorkspaceProps) {
  const { locale, t, formatAgentError } = useAgentI18n();
  const workspace = useAgentWorkspace({ sessionId, uiLocale: locale });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const sessionErrorContent = workspace.state.sessionErrorCode
    ? formatAgentError(workspace.state.sessionErrorCode, workspace.state.sessionError)
    : null;
  const bootstrapDescription =
    workspace.state.bootstrapReason ??
    (workspace.state.bootstrapStatus === "loading"
      ? t("workspace.bootstrap.loading")
      : resolveBootstrapDescription(workspace.state.bootstrapStatus, t));
  const currentTurnRunsHref = workspace.activeTurn?.turnId
    ? `/runs?turn_id=${encodeURIComponent(workspace.activeTurn.turnId)}`
    : null;
  const providerLabel = workspace.dependencyStatus
    ? `${formatProviderKindLabel(workspace.dependencyStatus.provider.id)} · ${workspace.dependencyStatus.provider.model}`
    : null;
  const currentTurnMemoriesHref = buildMemoriesHref({
    workspaceId: workspace.state.session?.workspace_id ?? null,
    taskId: workspace.state.activeTask?.taskId ?? null,
    turnId: workspace.activeTurn?.turnId ?? null
  });

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
        <div className="grid h-full min-h-0 flex-1 overflow-hidden xl:grid-cols-[20rem_minmax(0,1fr)] [grid-template-rows:minmax(0,1fr)] gap-6">
          <section className={`flex ${PANEL_HEIGHT_CLASS} flex-col overflow-hidden rounded-[1.75rem] border bg-surface shadow-sm`}>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="text-sm font-medium text-foreground">{t("workspace.sessionsTitle")}</div>
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
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <SessionList
                sessions={workspace.state.sessionList}
                activeSessionId={workspace.state.sessionId}
                activeSessionMemoriesHref={currentTurnMemoriesHref}
                activeSessionRunsHref={currentTurnRunsHref}
                onSelect={(nextSessionId) => {
                  void workspace.openSession(nextSessionId);
                }}
                onRename={(session, title) => {
                  void workspace.renameSession(session.id, title);
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
                    void workspace.refreshFileTree(nextPath);
                  }}
                  onOpenFile={(filePath) => {
                    void workspace.openFile(filePath);
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

          <div className="flex min-h-0 flex-col gap-4">
            {workspace.state.replayGapDetected ? (
              <ErrorState
                testId="agent-replay-gap"
                title={t("workspace.replayGapTitle")}
                description={t("workspace.replayGapDescription")}
              />
            ) : null}
            {workspace.state.sessionError && sessionErrorContent ? (
              <ErrorState
                testId="agent-session-error"
                title={sessionErrorContent.title}
                description={sessionErrorContent.description}
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
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
        </div>
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={workspace.agentConfig}
        dependencyStatus={workspace.dependencyStatus}
        memoryMode={workspace.state.session?.memory_mode ?? "workspace_plus_global"}
        onMemoryModeChange={(value) => {
          void workspace.updateMemoryMode(value);
        }}
        onSaveRuntime={(payload) => {
          return workspace.updateRuntimeConfig(payload);
        }}
        onCheckEmbeddings={() => {
          return workspace.checkEmbeddings();
        }}
        onCheckMemoryLlm={() => {
          return workspace.checkMemoryLlm();
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

