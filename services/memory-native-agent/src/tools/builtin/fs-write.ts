import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { buildDiffPreview, maybePersistArtifact, resolveWorkspacePath } from "../helpers.js";
import { ToolInputError } from "../errors.js";
import type { Tool } from "../types.js";

const argsSchema = z.object({
  path: z.string().trim().min(1),
  content: z.string(),
});

export function createFsWriteTool(): Tool {
  return {
    name: "fs_write",
    description: "Create or overwrite a file inside the current workspace.",
    parameters: {
      type: "object",
      required: ["path", "content"],
      properties: {
        path: { type: "string", description: "Relative file path inside the workspace." },
        content: { type: "string", description: "Full file content to write." },
      },
      additionalProperties: false,
    },
    permission: "confirm",
    trustLevel() {
      return "builtin_write";
    },
    buildConfirmPayload(args) {
      const parsed = argsSchema.safeParse(args);
      return {
        tool: "fs_write",
        params_preview: parsed.success ? parsed.data.path : "invalid_args",
        risk_hint: "write",
      };
    },
    async invoke(rawArgs, context) {
      const parsed = argsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        throw new ToolInputError(parsed.error.message, parsed.error);
      }

      const targetPath = resolveWorkspacePath(context.workspaceRoot, parsed.data.path, true);
      const before = await fs.readFile(targetPath, "utf8").catch(() => null);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, parsed.data.content, "utf8");

      const diff = buildDiffPreview(parsed.data.path, before, parsed.data.content);
      const artifact = maybePersistArtifact({
        content: diff,
        context,
        extension: "patch",
        kind: "file_diff",
      });

      return {
        ok: true,
        output: artifact.output,
        trust_level: "builtin_write",
        artifact_ref: artifact.artifact_ref,
        artifact: artifact.artifact_ref
          ? {
              kind: "file_diff",
              ref: artifact.artifact_ref,
            }
          : undefined,
      };
    },
  };
}
