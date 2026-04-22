import { z } from "zod";

import { matchWildcardPattern, maybePersistArtifact } from "../helpers.js";
import { ToolInputError, ToolPatternBlockedError, ToolTimeoutError } from "../errors.js";
import type { Tool } from "../types.js";
import { SandboxExecutor } from "../../sandbox/executor.js";

const DEFAULT_TIMEOUT_MS = 30_000;

const argsSchema = z.object({
  command: z.string().trim().min(1),
  description: z.string().trim().optional(),
  timeout_ms: z.number().int().min(1).max(120_000).optional(),
  max_output_bytes: z.number().int().min(256).max(5 * 1024 * 1024).optional(),
  env: z.record(z.string()).optional(),
});

export interface ShellExecToolOptions {
  denyPatterns: string[];
  defaultTimeoutMs?: number;
}

export function createShellExecTool(options: ShellExecToolOptions): Tool {
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const executor = new SandboxExecutor();

  return {
    name: "shell_exec",
    description: "Run a shell command inside the current workspace.",
    parallelism: "exclusive",
    parameters: {
      type: "object",
      required: ["command"],
      properties: {
        command: { type: "string" },
        description: { type: "string" },
        timeout_ms: { type: "number" },
        max_output_bytes: { type: "number" },
        env: {
          type: "object",
          additionalProperties: {
            type: "string",
          },
        },
      },
      additionalProperties: false,
    },
    permission: "confirm",
    trustLevel() {
      return "shell";
    },
    buildConfirmPayload(args) {
      const parsed = argsSchema.safeParse(args);
      return {
        tool: "shell_exec",
        params_preview: parsed.success ? parsed.data.command : "invalid_args",
        risk_hint: "shell",
      };
    },
    async invoke(rawArgs, context) {
      const parsed = argsSchema.safeParse(rawArgs);
      if (!parsed.success) {
        throw new ToolInputError(parsed.error.message, parsed.error);
      }

      const matchedPattern = options.denyPatterns.find((pattern) =>
        matchWildcardPattern(parsed.data.command, pattern)
      );
      if (matchedPattern) {
        throw new ToolPatternBlockedError(matchedPattern);
      }

      const timeoutMs = parsed.data.timeout_ms ?? defaultTimeoutMs;
      let result;
      try {
        result = await executor.run({
          command: parsed.data.command,
          cwd: context.cwd,
          workspaceRoot: context.workspaceRoot,
          networkEnabled: false,
          resourceLimits: {
            timeoutMs,
          },
          audit: {
            sessionId: context.sessionId,
            turnId: context.turnId,
            callId: context.callId,
            toolName: "shell_exec",
          },
          rollbackOnError: true,
          snapshotBeforeRun: true,
          env: parsed.data.env,
          abort: context.abort,
          timeoutMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/timed out|aborted/i.test(message)) {
          throw new ToolTimeoutError(message, error);
        }
        throw error;
      }

      const outputSections = [];
      if (result.stdout.trim().length > 0) {
        outputSections.push(`stdout:\n${result.stdout}`);
      }
      if (result.stderr.trim().length > 0) {
        outputSections.push(`stderr:\n${result.stderr}`);
      }
      if (outputSections.length === 0) {
        outputSections.push(`exit code: ${result.exitCode}`);
      }

      const combinedOutput = outputSections.join("\n\n");
      const artifact = maybePersistArtifact({
        content: combinedOutput,
        context,
        extension: "txt",
        kind: "stdout",
        maxInlineBytes: parsed.data.max_output_bytes,
      });

      return {
        ok: result.exitCode === 0,
        output: artifact.output,
        trust_level: "shell",
        artifact_ref: artifact.artifact_ref,
        changed_files: result.changedFiles,
        rolled_back: result.rolledBack,
        artifact: artifact.artifact_ref
          ? {
              kind: "stdout",
              ref: artifact.artifact_ref,
            }
          : undefined,
        exit_code: result.exitCode,
        error: result.exitCode === 0
          ? undefined
          : {
              code: "shell_exit_non_zero",
              message: `Shell command exited with code ${result.exitCode}.`,
            },
      };
    },
  };
}
