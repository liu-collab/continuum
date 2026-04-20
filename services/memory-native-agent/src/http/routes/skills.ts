import { z } from "zod";

import { SkillError, materializeSkillContext, resolveSkillInvocation } from "../../skills/index.js";
import type { RuntimeFastifyInstance } from "../types.js";

const importSkillSchema = z.object({
  path: z.string().trim().min(1),
});

export function registerSkillRoutes(app: RuntimeFastifyInstance) {
  app.get("/v1/skills", async () => ({
    items: app.runtimeState.skills.list().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      slash_name: skill.invocation.slashName,
      source_kind: skill.source.kind,
      root_dir: skill.source.rootDir,
      entry_file: skill.source.entryFile,
      imported_path: skill.source.originalPath ?? null,
      user_invocable: skill.invocation.userInvocable,
      model_invocable: skill.invocation.modelInvocable,
      preapproved_tools: skill.permissions.preapprovedTools ?? [],
    })),
  }));

  app.post("/v1/skills/import", async (request, reply) => {
    const payload = importSkillSchema.parse(request.body ?? {});

    try {
      const skill = app.runtimeState.skills.importFromPath(payload.path);
      return reply.code(201).send({
        ok: true,
        skill: {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          slash_name: skill.invocation.slashName,
          source_kind: skill.source.kind,
        },
      });
    } catch (error) {
      const skillError = error instanceof SkillError
        ? error
        : new SkillError("skill_import_failed", error instanceof Error ? error.message : String(error));
      return reply.code(skillError.code === "skill_not_found" ? 404 : 400).send({
        ok: false,
        error: {
          code: skillError.code,
          message: skillError.message,
          details: skillError.details,
        },
      });
    }
  });

  app.post("/v1/skills/preview", async (request, reply) => {
    const payload = z.object({
      input: z.string().trim().min(1),
    }).parse(request.body ?? {});

    const invocation = resolveSkillInvocation(app.runtimeState.skills, payload.input);
    if (!invocation) {
      return reply.code(404).send({
        error: {
          code: "skill_not_found",
          message: "Skill not found.",
        },
      });
    }

    try {
      const materialized = await materializeSkillContext(invocation, {
        cwd: app.runtimeState.config.memory.cwd,
      });
      return {
        skill_id: materialized.skill.id,
        slash_name: materialized.skill.invocation.slashName,
        preapproved_tools: materialized.preapprovedTools,
        system_prompt: materialized.systemPrompt,
      };
    } catch (error) {
      const skillError = error instanceof SkillError
        ? error
        : new SkillError("skill_runtime_error", error instanceof Error ? error.message : String(error));
      return reply.code(400).send({
        error: {
          code: skillError.code,
          message: skillError.message,
        },
      });
    }
  });
}

