"use client";

import React from "react";
import { ChevronRight, FileText, Folder, FolderPlus, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { useAgentI18n } from "@/lib/i18n/agent/provider";
import { getWorkspaceDebugId, getWorkspaceFolderLabel, getWorkspacePathLabel } from "../_lib/display";
import type { MnaFileTreeEntry, MnaWorkspaceSummary } from "../_lib/openapi-types";

type FileTreeProps = {
  path: string;
  entries: MnaFileTreeEntry[];
  workspaces: MnaWorkspaceSummary[];
  selectedWorkspaceId: string | null;
  selectedFilePath: string | null;
  onPickWorkspace(): Promise<void>;
  onClearWorkspace(): void;
  onOpenDirectory(targetPath: string): Promise<void> | void;
  onOpenFile(targetPath: string): Promise<void> | void;
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
  const [openingTarget, setOpeningTarget] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const selectedWorkspace = selectedWorkspaceId
    ? workspaces.find((item) => item.workspace_id === selectedWorkspaceId) ?? null
    : null;
  const selectedWorkspacePath = selectedWorkspace?.cwd ?? null;
  const selectedWorkspaceDebugId = selectedWorkspace ? getWorkspaceDebugId(selectedWorkspace) : null;
  const selectedWorkspaceDisplayName = getWorkspaceFolderLabel(selectedWorkspace);
  const selectedWorkspaceDisplayPath = getWorkspacePathLabel(selectedWorkspace);

  useEffect(() => {
    setOpenError(null);
    setOpeningTarget(null);
  }, [path, selectedWorkspaceId]);

  async function openDirectory(targetPath: string) {
    if (openingTarget) {
      return;
    }

    setOpeningTarget(targetPath);
    setRegisterError(null);
    setOpenError(null);
    try {
      await onOpenDirectory(targetPath);
    } catch {
      setOpenError(t("fileTree.openDirectoryError"));
    } finally {
      setOpeningTarget(null);
    }
  }

  async function openFile(targetPath: string) {
    if (openingTarget) {
      return;
    }

    setOpeningTarget(targetPath);
    setRegisterError(null);
    setOpenError(null);
    try {
      await onOpenFile(targetPath);
    } catch {
      setOpenError(t("fileTree.openFileError"));
    } finally {
      setOpeningTarget(null);
    }
  }

  return (
    <div className="panel">
      <div className="border-b px-4 py-3">
        <div className="flex flex-col gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">{t("fileTree.title")}</div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{path}</div>
          </div>
          {selectedWorkspace ? (
            <div className="rounded-[var(--radius-lg)] border bg-surface px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[12px] text-muted-foreground">{t("fileTree.selectedFolderLabel")}</div>
                  <div
                    data-testid="selected-workspace-path"
                    className="mt-1 truncate text-sm font-semibold text-foreground"
                    title={selectedWorkspacePath ?? undefined}
                  >
                    {selectedWorkspaceDisplayName}
                  </div>
                  <div
                    data-testid="selected-workspace-id"
                    className="mt-1 text-xs text-muted-foreground"
                    title={selectedWorkspaceDebugId ? `${t("fileTree.workspaceDebugIdLabel")}: ${selectedWorkspaceDebugId}` : undefined}
                  >
                    {t("fileTree.workspacePathLabel")}: {selectedWorkspaceDisplayPath}
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
              className="flex w-full flex-col items-center justify-center gap-2 border border-dashed border-border-strong bg-surface-muted/30 px-4 py-5 text-center transition hover:bg-surface-muted/50 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ borderRadius: "var(--radius-lg)" }}
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
              <div className="icon-button !h-11 !w-11">
                <FolderPlus className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold text-foreground">
                {picking ? t("fileTree.pickFolderPendingAction") : t("fileTree.pickFolderAction")}
              </div>
              <div className="text-xs text-muted-foreground">{t("fileTree.uploadHint")}</div>
            </button>
          )}
          <div className="grid gap-2">
            {registerError ? (
              <div className="text-[12px] text-[var(--ink)]">{registerError}</div>
            ) : null}
            {openError ? (
              <div data-testid="file-tree-open-error" className="text-[12px] text-[var(--ink)]">
                {openError}
              </div>
            ) : null}
            {picking ? (
              <div className="text-[12px] text-muted-foreground">
                {t("fileTree.pickFolderPendingHint")}
              </div>
            ) : null}
            {openingTarget ? (
              <div data-testid="file-tree-open-pending" className="text-[12px] text-muted-foreground">
                {t("fileTree.openPending")}
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
              disabled={openingTarget !== null}
              onClick={() => {
                void openDirectory(parentPath(path));
              }}
              className="mb-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ChevronRight className="h-3.5 w-3.5 rotate-180" />
              ..
            </button>
          ) : null}
          {entries.map((entry) => {
            const targetPath = normalizeChildPath(path, entry.name);
            const isSelected = selectedFilePath === targetPath;
            const isOpening = openingTarget === targetPath;

            return (
              <button
                key={`${entry.type}:${entry.name}`}
                type="button"
                disabled={openingTarget !== null}
                onClick={() => {
                  void (entry.type === "directory" ? openDirectory(targetPath) : openFile(targetPath));
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60",
                  isSelected && "bg-accent-soft text-foreground"
                )}
              >
                {isOpening ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                ) : entry.type === "directory" ? (
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
