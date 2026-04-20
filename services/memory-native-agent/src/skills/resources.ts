import fs from "node:fs";
import path from "node:path";

import type { SkillPackage, SkillResource, SkillResourceKind } from "./types.js";

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".py",
  ".sh",
  ".ps1",
  ".bash",
  ".zsh",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".xml",
  ".html",
  ".css",
  ".sql",
]);

export function collectSkillResources(rootDir: string, entryFile: string): SkillResource[] {
  const results: SkillResource[] = [];
  walk(rootDir, rootDir, entryFile, results);
  return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function renderSkillResourceContext(skill: SkillPackage, maxChars = 12_000): string {
  if (skill.content.resources.length === 0) {
    return "";
  }

  let budget = maxChars;
  const blocks: string[] = [];
  for (const resource of skill.content.resources) {
    if (!isTextResource(resource.absolutePath)) {
      continue;
    }

    const content = safeReadUtf8(resource.absolutePath);
    if (!content) {
      continue;
    }

    const trimmed = content.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const limited = trimmed.slice(0, Math.max(budget, 0));
    if (!limited) {
      break;
    }

    blocks.push([
      `<skill_resource path="${resource.relativePath}" kind="${resource.kind}">`,
      limited,
      "</skill_resource>",
    ].join("\n"));
    budget -= limited.length;
    if (budget <= 0) {
      break;
    }
  }

  return blocks.join("\n\n");
}

function walk(baseRootDir: string, currentDir: string, entryFile: string, results: SkillResource[]) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (absolutePath === entryFile) {
      continue;
    }

    if (entry.isDirectory()) {
      walk(baseRootDir, absolutePath, entryFile, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const relativePath = path.relative(baseRootDir, absolutePath).replace(/\\/g, "/");
    results.push({
      kind: detectResourceKind(relativePath),
      relativePath,
      absolutePath,
    });
  }
}

function detectResourceKind(relativePath: string): SkillResourceKind {
  if (relativePath.startsWith("references/")) {
    return "reference";
  }
  if (relativePath.startsWith("scripts/")) {
    return "script";
  }
  if (relativePath.startsWith("assets/")) {
    return "asset";
  }
  return "other";
}

function isTextResource(filePath: string): boolean {
  const extension = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(extension)) {
    return true;
  }

  const sample = fs.readFileSync(filePath);
  return !sample.includes(0);
}

function safeReadUtf8(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
