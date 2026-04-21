"use client";

import React from "react";
import { ChevronRight, FileText, Folder, FolderPlus } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { useAgentI18n } from "../_i18n/provider";
import type { MnaFileTreeEntry, MnaWorkspaceSummary } from "../_lib/openapi-types";

function getWorkspaceDisplayId(workspace: Pick<MnaWorkspaceSummary, "workspace_id" | "short_id">) {
  if (workspace.short_id && workspace.short_id.length > 0) {
    return workspace.short_id;
  }

  const normalized = workspace.workspace_id.replace(/[^a-zA-Z0-9]/g, "");
  if (normalized.length >= 8) {
    return normalized.slice(0, 8).toLowerCase();
  }

  return workspace.workspace_id.slice(0, 8).toLowerCase();
}

type FileTreeProps = {
  path: string;
  entries: MnaFileTreeEntry[];
  workspaces: MnaWorkspaceSummary[];
  selectedWorkspaceId: string | null;
  selectedFilePath: string | null;
  sessionWorkspaceId: string | null;
  sessionWorkspaceLabel: string | null;
  onPickWorkspace(): Promise<void>;
  onRegisterWorkspace(cwd: string): Promise<void>;
  onSelectWorkspace(workspaceId: string | null): void;
  onOpenDirectory(targetPath: string): void;
  onOpenFile(targetPath: string): void;
};

export function FileTree({
  path,
  entries,
  workspaces,
  selectedWorkspaceId,
  selectedFilePath,
  sessionWorkspaceId,
  sessionWorkspaceLabel,
  onPickWorkspace,
  onRegisterWorkspace,
  onSelectWorkspace,
  onOpenDirectory,
  onOpenFile
}: FileTreeProps) {
  const { t } = useAgentI18n();
  const [draftWorkspacePath, setDraftWorkspacePath] = useState("");
  const [registering, setRegistering] = useState(false);
  const [picking, setPicking] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);

  return (
    <div className="rounded-[1.75rem] border bg-surface">
      <div className="border-b px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">{t("fileTree.title")}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{path}</div>
            </div>
            <div className="w-full max-w-[14rem]">
              <label className="grid gap-1">
                <span className="text-[11px] text-muted-foreground">{t("fileTree.workspaceLabel")}</span>
                <select
                  data-testid="agent-file-tree-workspace-select"
                  value={selectedWorkspaceId ?? ""}
                  onChange={(event) => onSelectWorkspace(event.target.value || null)}
                  className="field h-9 text-xs"
                >
                  <option value="">{t("fileTree.workspacePlaceholder")}</option>
                  {workspaces.map((workspace) => (
                    <option key={workspace.workspace_id} value={workspace.workspace_id}>
                      {workspace.label} · {getWorkspaceDisplayId(workspace)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {sessionWorkspaceId ? (
            <div className="text-[11px] text-muted-foreground">
              {t("fileTree.sessionWorkspace", {
                label:
                  sessionWorkspaceId && sessionWorkspaceLabel
                    ? `${sessionWorkspaceLabel} · ${getWorkspaceDisplayId({
                        workspace_id: sessionWorkspaceId,
                        short_id: workspaces.find((item) => item.workspace_id === sessionWorkspaceId)?.short_id
                      })}`
                    : sessionWorkspaceLabel ?? sessionWorkspaceId
              })}
            </div>
          ) : null}
          <div className="grid gap-2">
            <button
              type="button"
              disabled={picking || registering}
              className="btn-outline h-9 justify-center text-xs disabled:opacity-60"
              onClick={() => {
                setPicking(true);
                setRegisterError(null);
                void onPickWorkspace()
                  .catch((error) => {
                    setRegisterError(error instanceof Error ? error.message : t("fileTree.pickError"));
                  })
                  .finally(() => {
                    setPicking(false);
                  });
              }}
            >
              <FolderPlus className="h-4 w-4" />
              {t("fileTree.pickFolderAction")}
            </button>
            <div className="flex gap-2">
              <input
                value={draftWorkspacePath}
                onChange={(event) => {
                  setDraftWorkspacePath(event.target.value);
                  if (registerError) {
                    setRegisterError(null);
                  }
                }}
                placeholder={t("fileTree.addPathPlaceholder")}
                className="field h-9 flex-1 text-xs"
              />
              <button
                type="button"
                disabled={registering || !draftWorkspacePath.trim()}
                className="btn-outline h-9 shrink-0 text-xs disabled:opacity-60"
                onClick={() => {
                  const nextPath = draftWorkspacePath.trim();
                  if (!nextPath) {
                    return;
                  }

                  setRegistering(true);
                  setRegisterError(null);
                  void onRegisterWorkspace(nextPath)
                    .then(() => {
                      setDraftWorkspacePath("");
                    })
                    .catch((error) => {
                      setRegisterError(error instanceof Error ? error.message : t("fileTree.registerError"));
                    })
                    .finally(() => {
                      setRegistering(false);
                    });
                }}
              >
                {t("fileTree.addPathAction")}
              </button>
            </div>
            {registerError ? (
              <div className="text-[11px] text-rose-700">{registerError}</div>
            ) : null}
          </div>
        </div>
      </div>
      {selectedWorkspaceId === null ? null : (
        <div className="max-h-[22rem] overflow-auto p-2">
          {path !== "." ? (
            <button
              type="button"
              onClick={() => onOpenDirectory(parentPath(path))}
              className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-surface-muted"
            >
              <ChevronRight className="h-3.5 w-3.5 rotate-180" />
              ..
            </button>
          ) : null}
          {entries.map((entry) => {
            const targetPath = normalizeChildPath(path, entry.name);
            const isSelected = selectedFilePath === targetPath;

            return (
              <button
                key={`${entry.type}:${entry.name}`}
                type="button"
                onClick={() =>
                  entry.type === "directory" ? onOpenDirectory(targetPath) : onOpenFile(targetPath)
                }
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition hover:bg-surface-muted",
                  isSelected && "bg-accent-soft text-foreground"
                )}
              >
                {entry.type === "directory" ? (
                  <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="truncate">{entry.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function normalizeChildPath(basePath: string, name: string) {
  if (basePath === "." || !basePath) {
    return name;
  }
  return `${basePath}/${name}`;
}

function parentPath(currentPath: string) {
  const parts = currentPath.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return ".";
  }
  return parts.slice(0, -1).join("/");
}
