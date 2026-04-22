import fs from "node:fs";
import path from "node:path";

import type { WorkspaceSnapshot } from "./types.js";

export function createWorkspaceSnapshot(workspaceRoot: string): WorkspaceSnapshot {
  const files = collectFiles(workspaceRoot).map((filePath) => ({
    path: filePath,
    content: fs.readFileSync(path.join(workspaceRoot, filePath), "utf8"),
  }));

  return { files };
}

export function diffWorkspaceSnapshot(
  before: WorkspaceSnapshot,
  after: WorkspaceSnapshot,
): string[] {
  const beforeMap = new Map(before.files.map((file) => [file.path, file.content]));
  const afterMap = new Map(after.files.map((file) => [file.path, file.content]));
  const changed = new Set<string>();

  for (const [filePath, content] of beforeMap) {
    if (!afterMap.has(filePath) || afterMap.get(filePath) !== content) {
      changed.add(filePath);
    }
  }

  for (const [filePath, content] of afterMap) {
    if (!beforeMap.has(filePath) || beforeMap.get(filePath) !== content) {
      changed.add(filePath);
    }
  }

  return [...changed].sort();
}

export function restoreWorkspaceSnapshot(workspaceRoot: string, snapshot: WorkspaceSnapshot) {
  const existing = new Set(collectFiles(workspaceRoot));
  const recorded = new Set(snapshot.files.map((file) => file.path));

  for (const file of snapshot.files) {
    const absolutePath = path.join(workspaceRoot, file.path);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, file.content ?? "", "utf8");
  }

  for (const filePath of existing) {
    if (!recorded.has(filePath)) {
      const absolutePath = path.join(workspaceRoot, filePath);
      if (fs.existsSync(absolutePath)) {
        fs.rmSync(absolutePath, { force: true });
      }
    }
  }
}

function collectFiles(workspaceRoot: string, current = "."): string[] {
  const target = path.join(workspaceRoot, current);
  if (!fs.existsSync(target)) {
    return [];
  }

  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return [current];
  }

  const results: string[] = [];
  const entries = fs.readdirSync(target, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }
    const next = current === "." ? entry.name : path.join(current, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(workspaceRoot, next));
      continue;
    }
    if (entry.isFile()) {
      results.push(next);
    }
  }
  return results;
}
