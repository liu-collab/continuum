import { expandSkillArguments, parseSkillArguments } from "./arguments.js";
import { renderSkillResourceContext } from "./resources.js";
import { expandSkillShellCommands } from "./shell-expander.js";
import type { SkillInvocation, SkillPackage } from "./types.js";

export interface MaterializedSkillContext {
  skill: SkillPackage;
  input: SkillInvocation;
  systemPrompt: string;
  modelOverride?: string;
  effort?: SkillPackage["runtime"]["effort"];
  preapprovedTools: string[];
}

export function resolveSkillInvocation(
  registry: { getBySlashName(name: string): SkillPackage | undefined },
  userInput: string,
): SkillInvocation | null {
  const trimmed = userInput.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  if (trimmed.startsWith("/skill ")) {
    const remainder = trimmed.slice("/skill ".length).trim();
    if (!remainder) {
      return null;
    }

    const [name, ...rest] = remainder.split(/\s+/);
    const skill = name ? registry.getBySlashName(normalizeSlashName(name)) : undefined;
    if (!skill) {
      return null;
    }

    const rawArguments = rest.join(" ").trim();
    return {
      skill,
      rawInput: userInput,
      rawArguments,
      positionalArguments: parseSkillArguments(rawArguments),
    };
  }

  const slashMatch = trimmed.match(/^\/([^\s]+)(?:\s+(.*))?$/);
  if (!slashMatch) {
    return null;
  }

  const [, slashName = "", rawArguments = ""] = slashMatch;
  const skill = registry.getBySlashName(normalizeSlashName(slashName));
  if (!skill) {
    return null;
  }

  return {
    skill,
    rawInput: userInput,
    rawArguments: rawArguments.trim(),
    positionalArguments: parseSkillArguments(rawArguments.trim()),
  };
}

export async function materializeSkillContext(
  invocation: SkillInvocation,
  options: { cwd: string },
): Promise<MaterializedSkillContext> {
  let markdown = expandSkillArguments(invocation.skill.content.markdown, invocation);
  markdown = await expandSkillShellCommands(markdown, {
    cwd: options.cwd,
    shell: invocation.skill.runtime.shell,
  });

  const resourceContext = renderSkillResourceContext(invocation.skill);
  const systemPrompt = [
    `<imported_skill name="${invocation.skill.name}" slash="/${invocation.skill.invocation.slashName}">`,
    `description: ${invocation.skill.description}`,
    invocation.skill.whenToUse ? `when_to_use: ${invocation.skill.whenToUse}` : null,
    invocation.skill.argumentHint ? `argument_hint: ${invocation.skill.argumentHint}` : null,
    invocation.rawArguments ? `raw_arguments: ${invocation.rawArguments}` : "raw_arguments:",
    invocation.positionalArguments.length > 0
      ? `positional_arguments: ${invocation.positionalArguments.map((item, index) => `[${index}] ${item}`).join("; ")}`
      : "positional_arguments:",
    "markdown:",
    markdown,
    resourceContext ? "supporting_files:" : null,
    resourceContext || null,
    "Treat the current user slash command as an explicit invocation of this imported skill.",
    "</imported_skill>",
  ].filter((item): item is string => Boolean(item)).join("\n");

  return {
    skill: invocation.skill,
    input: invocation,
    systemPrompt,
    modelOverride: invocation.skill.runtime.model,
    effort: invocation.skill.runtime.effort,
    preapprovedTools: invocation.skill.permissions.preapprovedTools ?? [],
  };
}

function normalizeSlashName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\/+/, "");
}

