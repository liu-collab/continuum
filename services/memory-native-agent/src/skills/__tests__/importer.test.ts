import path from "node:path";

import { describe, expect, it } from "vitest";

import { importSkillFromPath } from "../importer.js";
import { renderSkillResourceContext } from "../resources.js";
import { expandSkillArguments, parseSkillArguments } from "../arguments.js";
import { SkillError } from "../types.js";

const fixturesRoot = path.resolve("src/skills/__tests__/fixtures");

describe("skill importer", () => {
  it("imports a Codex skill directory and indexes resources", () => {
    const skill = importSkillFromPath(path.join(fixturesRoot, "codex-minimal"));

    expect(skill.source.kind).toBe("codex-skill");
    expect(skill.name).toBe("Repo Helper");
    expect(skill.invocation.slashName).toBe("repo-helper");
    expect(skill.content.resources).toEqual([
      expect.objectContaining({
        kind: "reference",
        relativePath: "references/guide.md",
      }),
    ]);
    expect(renderSkillResourceContext(skill)).toContain("Repo Guide");
  });

  it("imports a Claude skill directory and maps frontmatter fields", () => {
    const skill = importSkillFromPath(path.join(fixturesRoot, "claude-basic"));

    expect(skill.source.kind).toBe("claude-skill");
    expect(skill.whenToUse).toContain("deploy");
    expect(skill.argumentHint).toBe("environment service");
    expect(skill.permissions.preapprovedTools).toEqual(["shell_exec"]);
    expect(skill.runtime.model).toBe("claude-sonnet-4");
    expect(skill.runtime.effort).toBe("high");
    expect(skill.runtime.shell).toBe("powershell");
  });

  it("imports a Claude command markdown file", () => {
    const skill = importSkillFromPath(path.join(fixturesRoot, "claude-command", "deploy.md"));

    expect(skill.source.kind).toBe("claude-command");
    expect(skill.invocation.modelInvocable).toBe(false);
    expect(skill.invocation.slashName).toBe("deploy");
    expect(skill.permissions.preapprovedTools).toEqual(["shell_exec"]);
  });

  it("imports legacy yaml skill files", () => {
    const skill = importSkillFromPath(path.join(fixturesRoot, "legacy-skill.yaml"));

    expect(skill.source.kind).toBe("mna-legacy");
    expect(skill.content.markdown).toContain("Legacy system prompt");
    expect(skill.permissions.preapprovedTools).toEqual(["fs_read"]);
  });

  it("rejects unsupported Claude features", () => {
    expect(() => importSkillFromPath(path.join(fixturesRoot, "claude-unsupported"))).toThrowError(SkillError);
    expect(() => importSkillFromPath(path.join(fixturesRoot, "claude-unsupported"))).toThrow(/not supported/);
  });

  it("parses and expands skill arguments", () => {
    const args = parseSkillArguments(`prod "api service" --force`);
    expect(args).toEqual(["prod", "api service", "--force"]);
    expect(expandSkillArguments("deploy $0 to $1 using $ARGUMENTS", {
      skill: importSkillFromPath(path.join(fixturesRoot, "claude-basic")),
      rawInput: "/deploy-helper prod api",
      rawArguments: "prod api",
      positionalArguments: ["prod", "api"],
    })).toBe("deploy prod to api using prod api");
  });
});
