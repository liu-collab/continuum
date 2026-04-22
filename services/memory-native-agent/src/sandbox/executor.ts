import { spawn } from "node:child_process";

import { createWorkspaceSnapshot, diffWorkspaceSnapshot, restoreWorkspaceSnapshot } from "./workspace-snapshot.js";
import type { CommandExecutionInput, CommandExecutionResult, CommandExecutor } from "./types.js";

export class HostExecutor implements CommandExecutor {
  async run(input: CommandExecutionInput): Promise<CommandExecutionResult> {
    const command = process.platform === "win32" ? "cmd.exe" : "sh";
    const args = process.platform === "win32"
      ? ["/d", "/s", "/c", input.command]
      : ["-c", input.command];

    return await new Promise<CommandExecutionResult>((resolve, reject) => {
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
      let terminationReason: Error | null = null;

      const finalizeTermination = () => {
        if (!terminationReason) {
          return;
        }
        reject(terminationReason);
      };

      const timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        input.abort.removeEventListener("abort", abortListener);
        terminationReason = new Error(`Shell command timed out after ${input.timeoutMs}ms.`);
        void terminateChild(child.pid).finally(() => {
          setTimeout(() => finalizeTermination(), 50);
        });
      }, input.timeoutMs);

      const abortListener = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        terminationReason = new Error("Shell command was aborted.");
        void terminateChild(child.pid).finally(() => {
          setTimeout(() => finalizeTermination(), 50);
        });
      };
      input.abort.addEventListener("abort", abortListener, { once: true });

      child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
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
          if (terminationReason) {
            finalizeTermination();
          }
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
}

async function terminateChild(pid?: number) {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.on("exit", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Best effort termination.
  }
}

export class SandboxExecutor implements CommandExecutor {
  constructor(private readonly host = new HostExecutor()) {}

  async run(input: CommandExecutionInput): Promise<CommandExecutionResult> {
    const before = createWorkspaceSnapshot(input.cwd);

    try {
      const result = await this.host.run(input);
      const after = createWorkspaceSnapshot(input.cwd);
      return {
        ...result,
        snapshot: before,
        changedFiles: diffWorkspaceSnapshot(before, after),
      };
    } catch (error) {
      restoreWorkspaceSnapshot(input.cwd, before);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
        rolledBack: true,
      });
    }
  }
}
