import fs from "node:fs";
import path from "node:path";

import { parseMarkdownWithFrontmatter } from "../frontmatter.js";
import { collectSkillResources } from "../resources.js";
import type { SkillPackage } from "../types.js";
import { assertSupportedSkillFrontmatter, validateSkillPackage } from "../validator.js";

export function importClaudeCommand(entryFile: string, originalPath?: string): SkillPackage {
  const rootDir = path.dirname(entryFile);
  const parsed = parseMarkdownWithFrontmatter(fs.readFileSync(entryFile, "utf8"));
  assertSupportedSkillFrontmatter(parsed.frontmatter);
  const baseName = path.basename(entryFile, path.extname(entryFile));
  const name = stringValue(parsed.frontmatter.name) ?? baseName;
  const description = stringValue(parsed.frontmatter.description) ?? `${name} command`;

  const skill: SkillPackage = {
    id: buildSkillId("claude-command", baseName),
    name,
    description,
    whenToUse: stringValue(parsed.frontmatter.when_to_use),
    argumentHint: stringValue(parsed.frontmatter["argument-hint"]),
    source: {
      kind: "claude-command",
      rootDir,
      entryFile,
      originalPath,
    },
    content: {
      markdown: parsed.body,
      resources: collectSkillResources(rootDir, entryFile),
    },
    invocation: {
      userInvocable: true,
      modelInvocable: false,
      slashName: toSlashName(baseName),
      triggerPaths: stringArray(parsed.frontmatter.paths),
    },
    runtime: {
      shell: parsed.frontmatter.shell === "bash" || parsed.frontmatter.shell === "powershell"
        ? parsed.frontmatter.shell
        : undefined,
      model: stringValue(parsed.frontmatter.model),
      effort: parsed.frontmatter.effort === "low"
        || parsed.frontmatter.effort === "medium"
        || parsed.frontmatter.effort === "high"
        || parsed.frontmatter.effort === "xhigh"
        || parsed.frontmatter.effort === "max"
        ? parsed.frontmatter.effort
        : undefined,
    },
    permissions: {
      preapprovedTools: stringArray(parsed.frontmatter["allowed-tools"]),
    },
  };
  validateSkillPackage(skill);
  return skill;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return values.length > 0 ? values : undefined;
}

function buildSkillId(kind: SkillPackage["source"]["kind"], name: string): string {
  return `${kind}-${toSlashName(name)}`;
}

function toSlashName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "skill";
}
