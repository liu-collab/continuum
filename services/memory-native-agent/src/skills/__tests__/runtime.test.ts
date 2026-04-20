import path from "node:path";

import { describe, expect, it } from "vitest";

import { SkillRegistry } from "../registry.js";
import { importSkillFromPath } from "../importer.js";
import { materializeSkillContext, resolveSkillInvocation } from "../runtime.js";

const fixturesRoot = path.resolve("src/skills/__tests__/fixtures");

describe("skill runtime", () => {
  it("resolves /skill and /name invocations", () => {
    const registry = new SkillRegistry();
    const skill = importSkillFromPath(path.join(fixturesRoot, "codex-minimal"));
    registry.register(skill);

    const direct = resolveSkillInvocation(registry, "/repo-helper inspect README");
    const explicit = resolveSkillInvocation(registry, "/skill repo-helper inspect README");

    expect(direct?.skill.id).toBe(skill.id);
    expect(direct?.rawArguments).toBe("inspect README");
    expect(explicit?.rawArguments).toBe("inspect README");
  });

  it("materializes markdown, supporting files and shell commands", async () => {
    const registry = new SkillRegistry();
    const skill = importSkillFromPath(path.join(fixturesRoot, "claude-basic"));
    registry.register(skill);

    const invocation = resolveSkillInvocation(registry, "/deploy-helper prod service-a");
    if (!invocation) {
      throw new Error("Expected invocation.");
    }

    const context = await materializeSkillContext(invocation, {
      cwd: process.cwd(),
    });

    expect(context.modelOverride).toBe("claude-sonnet-4");
    expect(context.preapprovedTools).toEqual(["shell_exec"]);
    expect(context.systemPrompt).toContain("Collect deployment information for prod in service-a.");
    expect(context.systemPrompt).toContain("<skill_command");
    expect(context.systemPrompt).toContain("ok");
    expect(context.systemPrompt).toContain("Deploy Checklist");
  });
});
