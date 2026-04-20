import fs from "node:fs";
import path from "node:path";

import { parseMarkdownWithFrontmatter } from "../frontmatter.js";
import { collectSkillResources } from "../resources.js";
import type { SkillPackage, SkillRuntimeEffort } from "../types.js";
import { SkillError } from "../types.js";
import { assertSupportedSkillFrontmatter, validateSkillPackage } from "../validator.js";

export function importClaudeSkill(rootDir: string, originalPath?: string): SkillPackage {
  const entryFile = path.join(rootDir, "SKILL.md");
  const parsed = parseMarkdownWithFrontmatter(fs.readFileSync(entryFile, "utf8"));
  assertSupportedSkillFrontmatter(parsed.frontmatter);

  const name = stringValue(parsed.frontmatter.name) ?? path.basename(rootDir);
  const description = stringValue(parsed.frontmatter.description) ?? `${name} skill`;
  const shell = optionalShell(parsed.frontmatter.shell);
  const skill: SkillPackage = {
    id: buildSkillId("claude-skill", name),
    name,
    description,
    whenToUse: stringValue(parsed.frontmatter.when_to_use),
    argumentHint: stringValue(parsed.frontmatter["argument-hint"]),
    source: {
      kind: "claude-skill",
      rootDir,
      entryFile,
      originalPath,
    },
    content: {
      markdown: parsed.body,
      resources: collectSkillResources(rootDir, entryFile),
    },
    invocation: {
      userInvocable: booleanValue(parsed.frontmatter["user-invocable"]) ?? true,
      modelInvocable: !(booleanValue(parsed.frontmatter["disable-model-invocation"]) ?? false),
      slashName: toSlashName(name),
      triggerPaths: stringArray(parsed.frontmatter.paths),
    },
    runtime: {
      shell,
      model: stringValue(parsed.frontmatter.model),
      effort: optionalEffort(parsed.frontmatter.effort),
    },
    permissions: {
      preapprovedTools: stringArray(parsed.frontmatter["allowed-tools"]),
    },
  };
  validateSkillPackage(skill);
  return skill;
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  return values.length > 0 ? values : undefined;
}

function optionalShell(value: unknown): "bash" | "powershell" | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "bash" || value === "powershell") {
    return value;
  }

  throw new SkillError("skill_invalid", `Unsupported skill shell: ${String(value)}`);
}

function optionalEffort(value: unknown): SkillRuntimeEffort | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max") {
    return value;
  }

  throw new SkillError("skill_invalid", `Unsupported skill effort: ${String(value)}`);
}

