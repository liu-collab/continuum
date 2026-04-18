import fs from "node:fs/promises";
import { z } from "zod";

import { maybePersistArtifact, resolveWorkspacePath } from "../helpers.js";
import { ToolInputError } from "../errors.js";
import type { Tool } from "../types.js";

const argsSchema = z.object({
  path: z.string().trim().min(1),
});

export function createFsReadTool(): Tool {
  return {
    name: "fs_read",
    description: "Read a file or list a directory inside the current workspace.",
    parameters: {
      type: "object",
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Relative path inside the workspace.",
        },
      },
      additionalProperties: false,
    },
    permission: "auto",
    trustLevel() {
      return "builtin_read";
    },
    async invoke(rawArgs, context) {
      const parsed = argsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        throw new ToolInputError(parsed.error.message, parsed.error);
      }

      const targetPath = resolveWorkspacePath(context.workspaceRoot, parsed.data.path);
      const stat = await fs.stat(targetPath);

      if (stat.isDirectory()) {
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        const content = JSON.stringify(
          entries.map((entry) => ({
            name: entry.name,
            type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
          })),
          null,
          2,
        );

        const artifact = maybePersistArtifact({
          content,
          context,
          extension: "json",
          kind: "file_content",
        });

        return {
          ok: true,
          output: artifact.output,
          trust_level: "builtin_read",
          artifact_ref: artifact.artifact_ref,
          artifact: artifact.artifact_ref
            ? {
                kind: "file_content",
                ref: artifact.artifact_ref,
              }
            : undefined,
        };
      }

      const content = await fs.readFile(targetPath, "utf8");
      const artifact = maybePersistArtifact({
        content,
        context,
        extension: "txt",
        kind: "file_content",
      });

      return {
        ok: true,
        output: artifact.output,
        trust_level: "builtin_read",
        artifact_ref: artifact.artifact_ref,
        artifact: artifact.artifact_ref
          ? {
              kind: "file_content",
              ref: artifact.artifact_ref,
            }
          : undefined,
      };
    },
  };
}
