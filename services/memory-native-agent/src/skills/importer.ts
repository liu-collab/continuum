import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseMarkdownWithFrontmatter } from "./frontmatter.js";
import { importClaudeCommand } from "./adapters/claude-command.js";
import { importClaudeSkill } from "./adapters/claude-skill.js";
import { importCodexSkill } from "./adapters/codex-skill.js";
import { importLegacyYamlSkill } from "./adapters/legacy-yaml.js";
import type { SkillPackage } from "./types.js";
import { SkillError } from "./types.js";

const CLAUDE_FRONTMATTER_KEYS = new Set([
  "when_to_use",
  "argument-hint",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "model",
  "effort",
  "paths",
  "shell",
  "context",
  "agent",
  "hooks",
]);

export function importSkillFromPath(rawInputPath: string): SkillPackage {
  const targetPath = resolveInputPath(rawInputPath);
  if (!fs.existsSync(targetPath)) {
    throw new SkillError("skill_not_found", `Skill path not found: ${targetPath}`, { path: targetPath });
  }

  const stats = fs.statSync(targetPath);
  if (stats.isDirectory()) {
    const entryFile = path.join(targetPath, "SKILL.md");
    if (!fs.existsSync(entryFile)) {
      throw new SkillError("skill_invalid", `Skill directory is missing SKILL.md: ${targetPath}`, { path: targetPath });
    }

    const parsed = parseMarkdownWithFrontmatter(fs.readFileSync(entryFile, "utf8"));
    if (looksLikeClaudeSkill(targetPath, parsed.frontmatter)) {
      return importClaudeSkill(targetPath, rawInputPath);
    }
    return importCodexSkill(targetPath, rawInputPath);
  }

  const extension = path.extname(targetPath).toLowerCase();
  if (extension === ".md") {
    if (path.basename(targetPath).toLowerCase() === "skill.md") {
      return importSkillFromPath(path.dirname(targetPath));
    }
    return importClaudeCommand(targetPath, rawInputPath);
  }

  if (extension === ".yaml" || extension === ".yml") {
    return importLegacyYamlSkill(targetPath, rawInputPath);
  }

  throw new SkillError("skill_invalid", `Unsupported skill input path: ${targetPath}`, { path: targetPath });
}

export function discoverSkillInputs(pathsToScan: string[], workspaceRoot: string): string[] {
  const results = new Set<string>();
  for (const rawValue of pathsToScan) {
    const resolvedRoot = resolveDiscoveryPath(rawValue, workspaceRoot);
    if (!resolvedRoot || !fs.existsSync(resolvedRoot)) {
      continue;
    }

    const stats = fs.statSync(resolvedRoot);
    if (stats.isFile()) {
      results.add(resolvedRoot);
      continue;
    }

    if (path.basename(resolvedRoot).toLowerCase() === "commands") {
      for (const entry of fs.readdirSync(resolvedRoot, { withFileTypes: true })) {
        if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
          results.add(path.join(resolvedRoot, entry.name));
        }
      }
      continue;
    }

    if (fs.existsSync(path.join(resolvedRoot, "SKILL.md"))) {
      results.add(resolvedRoot);
      continue;
    }

    for (const entry of fs.readdirSync(resolvedRoot, { withFileTypes: true })) {
      const candidate = path.join(resolvedRoot, entry.name);
      if (entry.isDirectory() && fs.existsSync(path.join(candidate, "SKILL.md"))) {
        results.add(candidate);
      }
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
        results.add(candidate);
      }
    }
  }

  return [...results];
}

function resolveInputPath(rawInputPath: string): string {
  return path.resolve(expandHomePath(rawInputPath));
}

function resolveDiscoveryPath(rawInputPath: string, workspaceRoot: string): string | null {
  const expanded = expandHomePath(rawInputPath);
  if (path.isAbsolute(expanded)) {
    return path.resolve(expanded);
  }

  return path.resolve(workspaceRoot, expanded);
}

function expandHomePath(rawInputPath: string): string {
  if (rawInputPath.startsWith("~/")) {
    return path.join(os.homedir(), rawInputPath.slice(2));
  }

  return rawInputPath;
}

function looksLikeClaudeSkill(targetPath: string, frontmatter: Record<string, unknown>): boolean {
  const normalized = targetPath.replace(/\\/g, "/").toLowerCase();
  if (normalized.includes("/.claude/skills/")) {
    return true;
  }

  return Object.keys(frontmatter).some((key) => CLAUDE_FRONTMATTER_KEYS.has(key));
}

