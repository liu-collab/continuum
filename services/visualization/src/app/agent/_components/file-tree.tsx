"use client";

import React from "react";
import { ChevronRight, FileText, Folder } from "lucide-react";

import { cn } from "@/lib/utils";

import { useAgentI18n } from "../_i18n/provider";
import type { MnaFileTreeEntry } from "../_lib/openapi-types";

type FileTreeProps = {
  path: string;
  entries: MnaFileTreeEntry[];
  selectedFilePath: string | null;
  onOpenDirectory(targetPath: string): void;
  onOpenFile(targetPath: string): void;
};

export function FileTree({
  path,
  entries,
  selectedFilePath,
  onOpenDirectory,
  onOpenFile
}: FileTreeProps) {
  const { t } = useAgentI18n();

  return (
    <div className="rounded-lg border bg-surface">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-medium text-foreground">{t("fileTree.title")}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">{path}</div>
      </div>
      <div className="max-h-80 overflow-auto p-2">
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
