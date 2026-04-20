import { spawn } from "node:child_process";
import { z } from "zod";

import { matchWildcardPattern, maybePersistArtifact } from "../helpers.js";
import { ToolInputError, ToolPatternBlockedError, ToolTimeoutError } from "../errors.js";
import type { Tool } from "../types.js";

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

  return {
    name: "shell_exec",
    description: "Run a shell command inside the current workspace.",
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
      const result = await runShellCommand({
        command: parsed.data.command,
        cwd: context.workspaceRoot,
        env: parsed.data.env,
        abort: context.abort,
        timeoutMs,
      });

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

async function runShellCommand(input: {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  abort: AbortSignal;
  timeoutMs: number;
}) {
  const command = process.platform === "win32" ? "cmd.exe" : "sh";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", input.command]
    : ["-c", input.command];

  return await new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        ...input.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      input.abort.removeEventListener("abort", abortListener);
      void terminateChild(child).finally(() => {
        reject(new ToolTimeoutError(`Shell command timed out after ${input.timeoutMs}ms.`));
      });
    }, input.timeoutMs);

    const abortListener = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      input.abort.removeEventListener("abort", abortListener);
      void terminateChild(child).finally(() => {
        reject(new ToolTimeoutError("Shell command was aborted."));
      });
    };
    input.abort.addEventListener("abort", abortListener, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
    });
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      input.abort.removeEventListener("abort", abortListener);
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      input.abort.removeEventListener("abort", abortListener);
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? 0,
      });
    });
  });
}

async function terminateChild(child: ReturnType<typeof spawn>) {
  if (process.platform === "win32") {
    if (child.pid) {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore",
        });
        killer.on("exit", () => resolve());
        killer.on("error", () => resolve());
      });
      return;
    }

    child.kill();
    return;
  }

  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
}
