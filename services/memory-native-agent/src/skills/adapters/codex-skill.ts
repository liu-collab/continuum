import fs from "node:fs";
import path from "node:path";

import { parseMarkdownWithFrontmatter } from "../frontmatter.js";
import { collectSkillResources } from "../resources.js";
import type { SkillPackage } from "../types.js";
import { assertSupportedSkillFrontmatter, validateSkillPackage } from "../validator.js";

export function importCodexSkill(rootDir: string, originalPath?: string): SkillPackage {
  const entryFile = path.join(rootDir, "SKILL.md");
  const parsed = parseMarkdownWithFrontmatter(fs.readFileSync(entryFile, "utf8"));
  assertSupportedSkillFrontmatter(parsed.frontmatter);

  const name = stringValue(parsed.frontmatter.name) ?? path.basename(rootDir);
  const description = stringValue(parsed.frontmatter.description) ?? `${name} skill`;
  const skill: SkillPackage = {
    id: buildSkillId("codex-skill", name),
    name,
    description,
    source: {
      kind: "codex-skill",
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
      modelInvocable: true,
      slashName: toSlashName(name),
    },
    runtime: {},
    permissions: {},
  };
  validateSkillPackage(skill);
  return skill;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
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

