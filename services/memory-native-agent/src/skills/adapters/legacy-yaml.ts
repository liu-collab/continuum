import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { collectSkillResources } from "../resources.js";
import type { SkillPackage } from "../types.js";
import { SkillError } from "../types.js";
import { validateSkillPackage } from "../validator.js";

export function importLegacyYamlSkill(entryFile: string, originalPath?: string): SkillPackage {
  const parsed = parseYaml(fs.readFileSync(entryFile, "utf8"));
  if (!isPlainObject(parsed)) {
    throw new SkillError("skill_invalid", "Legacy skill file must be a YAML object.");
  }

  const name = stringValue(parsed.name) ?? path.basename(entryFile, path.extname(entryFile));
  const description = stringValue(parsed.description) ?? `${name} legacy skill`;
  const markdown = [stringValue(parsed.system_prompt), stringValue(parsed.execution_prompt)]
    .filter((item): item is string => Boolean(item))
    .join("\n\n")
    .trim();

  const skill: SkillPackage = {
    id: `mna-legacy-${toSlashName(name)}`,
    name,
    description,
    argumentHint: stringValue(parsed.argument_hint),
    source: {
      kind: "mna-legacy",
      rootDir: path.dirname(entryFile),
      entryFile,
      originalPath,
    },
    content: {
      markdown,
      resources: collectSkillResources(path.dirname(entryFile), entryFile),
    },
    invocation: {
      userInvocable: true,
      modelInvocable: false,
      slashName: toSlashName(name),
    },
    runtime: {},
    permissions: {
      preapprovedTools: stringArray(parsed.allowed_tools),
    },
  };
  validateSkillPackage(skill);
  return skill;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function toSlashName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "skill";
}

