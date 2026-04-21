"use client";

import React from "react";
import { ChevronRight, FileText, Folder, FolderPlus, X } from "lucide-react";
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
  onPickWorkspace(): Promise<void>;
  onClearWorkspace(): void;
  onOpenDirectory(targetPath: string): void;
  onOpenFile(targetPath: string): void;
};

export function FileTree({
  path,
  entries,
  workspaces,
  selectedWorkspaceId,
  selectedFilePath,
  onPickWorkspace,
  onClearWorkspace,
  onOpenDirectory,
  onOpenFile
}: FileTreeProps) {
  const { t } = useAgentI18n();
  const [picking, setPicking] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const selectedWorkspace = selectedWorkspaceId
    ? workspaces.find((item) => item.workspace_id === selectedWorkspaceId) ?? null
    : null;
  const selectedWorkspacePath = selectedWorkspace?.cwd ?? null;
  const selectedWorkspaceDisplayId = selectedWorkspace ? getWorkspaceDisplayId(selectedWorkspace) : null;

  return (
    <div className="rounded-[1.75rem] border bg-surface">
      <div className="border-b px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">{t("fileTree.title")}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{path}</div>
          </div>
          {selectedWorkspace ? (
            <div className="rounded-xl border bg-surface px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] text-muted-foreground">{t("fileTree.selectedFolderLabel")}</div>
                  <div
                    data-testid="selected-workspace-path"
                    className="mt-1 break-all text-sm font-medium text-foreground"
                    title={selectedWorkspacePath ?? undefined}
                  >
                    {selectedWorkspacePath}
                  </div>
                  <div
                    data-testid="selected-workspace-id"
                    className="mt-1 text-xs text-muted-foreground"
                  >
                    {t("fileTree.workspaceIdLabel")}: {selectedWorkspaceDisplayId}
                  </div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition hover:bg-surface-muted hover:text-foreground"
                  aria-label={t("fileTree.clearFolderAction")}
                  title={t("fileTree.clearFolderAction")}
                  onClick={() => {
                    setRegisterError(null);
                    onClearWorkspace();
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
          {selectedWorkspace ? null : (
            <button
              type="button"
              disabled={picking}
              data-testid="agent-file-tree-picker"
              aria-label={picking ? t("fileTree.pickFolderPendingAction") : t("fileTree.pickFolderAction")}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-[1.25rem] border border-dashed border-border-strong bg-surface-muted/30 px-4 py-5 text-center transition hover:bg-surface-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
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
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface text-muted-foreground shadow-sm">
                <FolderPlus className="h-5 w-5" />
              </div>
              <div className="text-sm font-medium text-foreground">
                {picking ? t("fileTree.pickFolderPendingAction") : t("fileTree.pickFolderAction")}
              </div>
              <div className="text-xs text-muted-foreground">{t("fileTree.uploadHint")}</div>
            </button>
          )}
          <div className="grid gap-2">
            {registerError ? (
              <div className="text-[11px] text-rose-700">{registerError}</div>
            ) : null}
            {picking ? (
              <div className="text-[11px] text-muted-foreground">
                {t("fileTree.pickFolderPendingHint")}
              </div>
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
