import { z } from "zod";

import { McpServerUnavailableError, McpToolCallError, type McpRegistry } from "../../mcp-client/index.js";
import { maybePersistArtifact } from "../helpers.js";
import { ToolExecutionError, ToolInputError } from "../errors.js";
import type { Tool } from "../types.js";

const argsSchema = z.object({
  server: z.string().trim().min(1),
  tool: z.string().trim().min(1),
  args: z.record(z.unknown()).optional(),
});

export function createMcpCallTool(registry: McpRegistry): Tool {
  return {
    name: "mcp_call",
    description: "Call an external MCP tool by server and tool name.",
    parameters: {
      type: "object",
      required: ["server", "tool"],
      properties: {
        server: { type: "string" },
        tool: { type: "string" },
        args: { type: "object", additionalProperties: true },
      },
      additionalProperties: false,
    },
    permission: "confirm",
    trustLevel(args) {
      const parsed = argsSchema.safeParse(args);
      return `mcp:${parsed.success ? parsed.data.server : "unknown"}`;
    },
    buildConfirmPayload(args) {
      const parsed = argsSchema.safeParse(args);
      return {
        tool: "mcp_call",
        params_preview: parsed.success
          ? `${parsed.data.server}:${parsed.data.tool}`
          : "invalid_args",
        risk_hint: "mcp",
      };
    },
    sessionPermissionKey(args) {
      const parsed = argsSchema.safeParse(args);
      return parsed.success ? `mcp:${parsed.data.server}:${parsed.data.tool}` : "mcp_call";
    },
    async invoke(rawArgs, context) {
      const parsed = argsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        throw new ToolInputError(parsed.error.message, parsed.error);
      }

      try {
        const result = await registry.callTool(parsed.data.server, parsed.data.tool, parsed.data.args ?? {});
        const textParts = result.content
          .map((item) => {
            switch (item.type) {
              case "text":
                return item.text;
              case "resource_link":
                return `${item.name}: ${item.uri}`;
              default:
                return JSON.stringify(item);
            }
          })
          .filter(Boolean);

        if (result.structured_content) {
          textParts.push(JSON.stringify(result.structured_content, null, 2));
        }

        const content = textParts.join("\n\n");
        const artifact = maybePersistArtifact({
          content,
          context,
          extension: "txt",
          kind: "stdout",
        });

        return {
          ok: !result.is_error,
          output: artifact.output,
          trust_level: `mcp:${parsed.data.server}`,
          artifact_ref: artifact.artifact_ref,
          artifact: artifact.artifact_ref
            ? {
                kind: "stdout",
                ref: artifact.artifact_ref,
              }
            : undefined,
          error: result.is_error
            ? {
                code: "mcp_tool_error",
                message: `MCP tool ${parsed.data.server}:${parsed.data.tool} reported an error.`,
              }
            : undefined,
        };
      } catch (error) {
        if (error instanceof McpServerUnavailableError) {
          throw new ToolExecutionError(error.message, {
            code: "mcp_disconnected",
            cause: error,
          });
        }
        if (error instanceof McpToolCallError) {
          throw new ToolExecutionError(error.message, {
            code: "mcp_tool_error",
            cause: error,
          });
        }
        throw error;
      }
    },
  };
}
