import fs from "node:fs/promises";
import { z } from "zod";

import { buildDiffPreview, maybePersistArtifact, resolveWorkspacePath } from "../helpers.js";
import { ToolExecutionError, ToolInputError } from "../errors.js";
import type { Tool } from "../types.js";

const argsSchema = z.object({
  path: z.string().trim().min(1),
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

function countOccurrences(content: string, needle: string) {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let cursor = 0;
  while (cursor <= content.length) {
    const index = content.indexOf(needle, cursor);
    if (index === -1) {
      return count;
    }
    count += 1;
    cursor = index + needle.length;
  }
  return count;
}

export function createFsEditTool(): Tool {
  return {
    name: "fs_edit",
    description: "Replace a unique string inside a file in the current workspace.",
    parameters: {
      type: "object",
      required: ["path", "old_string", "new_string"],
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
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
        tool: "fs_edit",
        params_preview: parsed.success ? parsed.data.path : "invalid_args",
        risk_hint: "write",
      };
    },
    async invoke(rawArgs, context) {
      const parsed = argsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        throw new ToolInputError(parsed.error.message, parsed.error);
      }

      const targetPath = resolveWorkspacePath(context.workspaceRoot, parsed.data.path);
      const before = await fs.readFile(targetPath, "utf8");
      const matchCount = countOccurrences(before, parsed.data.old_string);

      if (matchCount === 0) {
        throw new ToolExecutionError("old_string was not found in the file.", {
          code: "tool_edit_match_not_found",
        });
      }

      if (!parsed.data.replace_all && matchCount > 1) {
        throw new ToolExecutionError("old_string matched more than once. Provide a more specific string.", {
          code: "tool_edit_match_not_unique",
        });
      }

      const after = parsed.data.replace_all
        ? before.split(parsed.data.old_string).join(parsed.data.new_string)
        : before.replace(parsed.data.old_string, parsed.data.new_string);

      await fs.writeFile(targetPath, after, "utf8");

      const diff = buildDiffPreview(parsed.data.path, before, after);
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
