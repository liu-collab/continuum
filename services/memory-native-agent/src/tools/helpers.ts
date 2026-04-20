import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import { ToolArtifactTooLargeError, ToolPermissionError } from "./errors.js";
import type { ToolArtifactKind, ToolContext } from "./types.js";

const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024;

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)]),
  );
}

export function hashArgs(args: unknown): string {
  return createHash("sha256").update(stableJsonStringify(args)).digest("hex");
}

export function previewArgs(args: unknown, maxLength = 512): string {
  const serialized = stableJsonStringify(args);
  return serialized.length <= maxLength ? serialized : serialized.slice(0, maxLength);
}

export function truncateOutput(value: string): string {
  return truncateOutputToBytes(value, DEFAULT_MAX_OUTPUT_BYTES);
}

export function truncateOutputToBytes(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) {
    return value;
  }

  const headBytes = Math.max(Math.floor(maxBytes * 0.7), 64);
  const tailBytes = Math.max(maxBytes - headBytes, 32);
  const head = sliceUtf8Bytes(value, headBytes);
  const tail = sliceUtf8BytesFromEnd(value, tailBytes);
  return `${head}\n...\n${tail}`;
}

function sliceUtf8Bytes(value: string, maxBytes: number): string {
  return Buffer.from(value, "utf8").subarray(0, maxBytes).toString("utf8");
}

function sliceUtf8BytesFromEnd(value: string, maxBytes: number): string {
  const buffer = Buffer.from(value, "utf8");
  return buffer.subarray(Math.max(buffer.length - maxBytes, 0)).toString("utf8");
}

export function maybePersistArtifact(input: {
  content: string;
  context: ToolContext;
  extension: string;
  kind: ToolArtifactKind;
  maxInlineBytes?: number;
}): { output: string; artifact_ref?: string } {
  const maxInlineBytes = input.maxInlineBytes ?? input.context.maxOutputChars ?? DEFAULT_MAX_OUTPUT_BYTES;
  const bytes = Buffer.byteLength(input.content, "utf8");
  if (bytes <= maxInlineBytes) {
    return {
      output: input.content,
    };
  }

  if (bytes > MAX_ARTIFACT_BYTES) {
    throw new ToolArtifactTooLargeError("Tool output exceeds the maximum artifact size.");
  }

  const sessionDir = path.join(input.context.artifactsRoot, input.context.sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const fileName = `${input.context.callId}.${input.extension.replace(/^\./, "")}`;
  const targetPath = path.join(sessionDir, fileName);
  fs.writeFileSync(targetPath, input.content, "utf8");

  return {
    output: truncateOutputToBytes(input.content, maxInlineBytes),
    artifact_ref: `${input.context.sessionId}/${fileName}`,
  };
}

export function resolveWorkspacePath(workspaceRoot: string, relativePath: string, allowMissingLeaf = false): string {
  if (path.isAbsolute(relativePath)) {
    throw new ToolPermissionError("Absolute paths are not allowed.", "tool_denied_path");
  }

  const rootResolved = path.resolve(workspaceRoot);
  const targetPath = path.resolve(workspaceRoot, relativePath);
  const lexicalRelative = path.relative(rootResolved, targetPath);
  if (lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) {
    throw new ToolPermissionError("Resolved path escapes the workspace root.", "tool_denied_path");
  }

  const rootReal = fs.realpathSync.native(workspaceRoot);
  const existingTarget = allowMissingLeaf || !fs.existsSync(targetPath)
    ? findExistingParent(targetPath)
    : targetPath;
  const realTarget = fs.realpathSync.native(existingTarget);

  if (!isWithinRoot(rootReal, realTarget)) {
    throw new ToolPermissionError("Resolved path escapes the workspace root.", "tool_denied_path");
  }

  return targetPath;
}

function findExistingParent(targetPath: string): string {
  let cursor = targetPath;
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  return cursor;
}

function isWithinRoot(rootReal: string, candidateReal: string): boolean {
  const relative = path.relative(rootReal, candidateReal);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function buildDiffPreview(filePath: string, before: string | null, after: string): string {
  const relativeLabel = filePath.replace(/\\/g, "/");
  const beforeLines = (before ?? "").split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);

  const lines = [`--- ${relativeLabel}`, `+++ ${relativeLabel}`];
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  for (let index = 0; index < maxLines; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) {
      if (beforeLine !== undefined) {
        lines.push(` ${beforeLine}`);
      }
      continue;
    }
    if (beforeLine !== undefined) {
      lines.push(`-${beforeLine}`);
    }
    if (afterLine !== undefined) {
      lines.push(`+${afterLine}`);
    }
  }

  return lines.join("\n");
}

export function matchWildcardPattern(value: string, pattern: string): boolean {
  const normalizedValue = value.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();
  const parts = normalizedPattern.split("*").filter(Boolean);

  if (parts.length === 0) {
    return normalizedValue.includes(normalizedPattern.replaceAll("*", ""));
  }

  let cursor = 0;
  for (const part of parts) {
    const index = normalizedValue.indexOf(part, cursor);
    if (index === -1) {
      return false;
    }
    cursor = index + part.length;
  }

  return true;
}
