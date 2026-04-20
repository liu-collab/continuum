import type { SkillPackage } from "./types.js";
import { SkillError } from "./types.js";

const UNSUPPORTED_FIELDS = ["context", "agent", "hooks"] as const;

export function assertSupportedSkillFrontmatter(frontmatter: Record<string, unknown>) {
  for (const field of UNSUPPORTED_FIELDS) {
    if (frontmatter[field] !== undefined) {
      throw new SkillError(
        "skill_unsupported_feature",
        `Skill frontmatter field "${field}" is not supported yet.`,
        { field },
      );
    }
  }
}

export function validateSkillPackage(skill: SkillPackage) {
  if (!skill.name.trim()) {
    throw new SkillError("skill_invalid", "Skill name is required.");
  }

  if (!skill.description.trim()) {
    throw new SkillError("skill_invalid", "Skill description is required.");
  }

  if (!skill.invocation.slashName.trim()) {
    throw new SkillError("skill_invalid", "Skill slash name is required.");
  }
}

