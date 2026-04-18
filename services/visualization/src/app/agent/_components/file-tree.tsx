"use client";

import { ChevronRight, FileText, Folder } from "lucide-react";

import { cn } from "@/lib/utils";

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
  return (
    <div className="rounded-2xl border bg-white/75">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold text-slate-900">文件树</div>
        <div className="mt-1 truncate text-xs text-slate-500">{path}</div>
      </div>
      <div className="max-h-[24rem] overflow-auto px-2 py-2">
        {path !== "." ? (
          <button
            type="button"
            onClick={() => onOpenDirectory(parentPath(path))}
            className="mb-2 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-50"
          >
            <ChevronRight className="h-4 w-4 rotate-180" />
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
                "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50",
                isSelected && "bg-accent/10 text-accent"
              )}
            >
              {entry.type === "directory" ? (
                <Folder className="h-4 w-4 text-amber-600" />
              ) : (
                <FileText className="h-4 w-4 text-slate-400" />
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
