import { exec, execFile } from "node:child_process";
import type { ExecException, ExecFileException } from "node:child_process";

import { SkillError } from "./types.js";

export interface ShellExpansionOptions {
  cwd: string;
  shell?: "bash" | "powershell";
  timeoutMs?: number;
}

export async function expandSkillShellCommands(markdown: string, options: ShellExpansionOptions): Promise<string> {
  const lines = markdown.split(/\r?\n/);
  const resolved: string[] = [];

  for (const line of lines) {
    const command = parseBangCommand(line);
    if (!command) {
      resolved.push(line);
      continue;
    }

    const output = await runCommand(command, options);
    resolved.push([
      `<skill_command command="${escapeAttribute(command)}">`,
      output.trim(),
      "</skill_command>",
    ].join("\n"));
  }

  return resolved.join("\n");
}

function parseBangCommand(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("!") || trimmed === "!") {
    return null;
  }

  return trimmed.slice(1).trim() || null;
}

function runCommand(command: string, options: ShellExpansionOptions): Promise<string> {
  if (options.shell === "powershell") {
    return new Promise((resolve, reject) => {
      execFile(
        process.platform === "win32" ? "powershell.exe" : "pwsh",
        ["-NoProfile", "-Command", command],
        {
          cwd: options.cwd,
          timeout: options.timeoutMs ?? 5_000,
          encoding: "utf8",
          maxBuffer: 256 * 1024,
        },
        (error: ExecFileException | null, stdout: string, stderr: string) => {
          if (error) {
            reject(new SkillError("skill_command_failed", `Skill shell command failed: ${command}`, {
              command,
              stderr: stderr.trim(),
            }));
            return;
          }

          resolve(stdout || stderr);
        },
      );
    });
  }

  if (options.shell === "bash") {
    return new Promise((resolve, reject) => {
      execFile(
        process.platform === "win32" ? "bash" : "/bin/bash",
        ["-lc", command],
        {
          cwd: options.cwd,
          timeout: options.timeoutMs ?? 5_000,
          encoding: "utf8",
          maxBuffer: 256 * 1024,
        },
        (error: ExecFileException | null, stdout: string, stderr: string) => {
          if (error) {
            reject(new SkillError("skill_command_failed", `Skill shell command failed: ${command}`, {
              command,
              stderr: stderr.trim(),
            }));
            return;
          }

          resolve(stdout || stderr);
        },
      );
    });
  }

  return new Promise((resolve, reject) => {
    exec(command, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 5_000,
      encoding: "utf8",
      maxBuffer: 256 * 1024,
    }, (error: ExecException | null, stdout: string, stderr: string) => {
      if (error) {
        reject(new SkillError("skill_command_failed", `Skill shell command failed: ${command}`, {
          command,
          stderr: stderr.trim(),
        }));
        return;
      }

      resolve(stdout || stderr);
    });
  });
}

function escapeAttribute(value: string): string {
  return value.replaceAll("\"", "&quot;");
}
