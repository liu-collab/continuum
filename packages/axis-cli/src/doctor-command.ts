import { statfs } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  axisHomeDir,
  DEFAULT_MANAGED_POSTGRES_PORT,
} from "./managed-state.js";
import { bilingualMessage } from "./messages.js";
import {
  DEFAULT_RUNTIME_PORT,
  DEFAULT_STORAGE_PORT,
  DEFAULT_VISUALIZATION_PORT,
  isTcpPortAvailable,
  LOOPBACK_BIND_HOST,
} from "./port-utils.js";
import { runCommand } from "./utils.js";

type DoctorCheck = {
  level: "ok" | "warn" | "fail";
  label: string;
  detail?: string;
};

function formatCheck(check: DoctorCheck) {
  const marker = check.level === "ok" ? "✓" : check.level === "warn" ? "⚠" : "✗";
  return `${marker} ${check.label}${check.detail ? ` ${check.detail}` : ""}`;
}

function parseNodeMajor(version: string) {
  const match = /^v?(\d+)\./.exec(version.trim());
  return match ? Number(match[1]) : 0;
}

async function checkDockerInstalled(): Promise<DoctorCheck> {
  const result = await runCommand("docker", ["--version"], {
    captureOutput: true,
    env: process.env,
    timeoutMs: 1_500,
  }).catch((error: unknown) => ({
    code: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  }));

  if (result.code === 0) {
    return {
      level: "ok",
      label: bilingualMessage("Docker 已安装", "Docker is installed"),
    };
  }

  return {
    level: "fail",
    label: bilingualMessage(
      "Docker 未安装或 docker 命令不可用",
      "Docker is not installed or the docker command is unavailable",
    ),
  };
}

async function checkDockerRunning(): Promise<DoctorCheck> {
  const result = await runCommand("docker", ["version"], {
    captureOutput: true,
    env: process.env,
    timeoutMs: 2_000,
  }).catch((error: unknown) => ({
    code: 1,
    stdout: "",
    stderr: error instanceof Error ? error.message : String(error),
  }));

  if (result.code === 0) {
    return {
      level: "ok",
      label: bilingualMessage("Docker 正在运行", "Docker is running"),
    };
  }

  return {
    level: "fail",
    label: bilingualMessage(
      "Docker 未运行，请先启动 Docker Desktop（Windows/macOS）或 Docker Engine（Linux）",
      "Docker is not running. Start Docker Desktop (Windows/macOS) or Docker Engine (Linux) first",
    ),
  };
}

async function checkPort(port: number): Promise<DoctorCheck> {
  const available = await isTcpPortAvailable(LOOPBACK_BIND_HOST, port);
  return available
    ? {
        level: "ok",
        label: bilingualMessage(`端口 ${port} 可用`, `Port ${port} is available`),
      }
    : {
        level: "fail",
        label: bilingualMessage(`端口 ${port} 已被占用`, `Port ${port} is already in use`),
      };
}

async function checkDiskSpace(): Promise<DoctorCheck> {
  try {
    const stats = await statfs(axisHomeDir()).catch(() => statfs(path.dirname(axisHomeDir())));
    const freeBytes = Number(stats.bavail) * Number(stats.bsize);
    const freeGiB = freeBytes / 1024 / 1024 / 1024;
    if (freeBytes >= 2 * 1024 * 1024 * 1024) {
      return {
        level: "ok",
        label: bilingualMessage(
          "磁盘空间充足（> 2GB）",
          "Disk space is sufficient (> 2GB)",
        ),
        detail: `(${freeGiB.toFixed(1)}GB)`,
      };
    }

    return {
      level: "fail",
      label: bilingualMessage(
        "磁盘空间不足，建议至少预留 2GB",
        "Disk space is low. Keep at least 2GB free",
      ),
      detail: `(${freeGiB.toFixed(1)}GB)`,
    };
  } catch {
    return {
      level: "warn",
      label: bilingualMessage(
        "无法检查磁盘空间",
        "Could not check disk space",
      ),
    };
  }
}

function checkNode(): DoctorCheck {
  const major = parseNodeMajor(process.version);
  return major >= 22
    ? {
        level: "ok",
        label: bilingualMessage("Node.js 22.0+", "Node.js 22.0+"),
        detail: `(${process.version})`,
      }
    : {
        level: "fail",
        label: bilingualMessage(
          `Node.js 版本过低，需要 22.0+，当前 ${process.version}`,
          `Node.js is too old. 22.0+ is required, current ${process.version}`,
        ),
      };
}

function checkProviderKey(): DoctorCheck {
  const hasKey = Boolean(
    process.env.OPENAI_API_KEY
    || process.env.ANTHROPIC_API_KEY
    || process.env.DEEPSEEK_API_KEY,
  );

  return hasKey
    ? {
        level: "ok",
        label: bilingualMessage(
          "已检测到模型 API Key 环境变量",
          "Model API key environment variable detected",
        ),
      }
    : {
        level: "warn",
        label: bilingualMessage(
          "未检测到 OPENAI_API_KEY，启动后需手动配置 provider",
          "OPENAI_API_KEY was not detected. Configure a provider manually after startup",
        ),
      };
}

export async function runDoctorCommand() {
  const [dockerInstalled, dockerRunning, ...portChecks] = await Promise.all([
    checkDockerInstalled(),
    checkDockerRunning(),
    checkPort(DEFAULT_STORAGE_PORT),
    checkPort(DEFAULT_RUNTIME_PORT),
    checkPort(DEFAULT_VISUALIZATION_PORT),
    checkPort(DEFAULT_MANAGED_POSTGRES_PORT),
  ]);
  const checks: DoctorCheck[] = [
    checkNode(),
    dockerInstalled,
    dockerRunning,
    ...portChecks,
    checkProviderKey(),
    await checkDiskSpace(),
  ];

  process.stdout.write("Axis doctor\n");
  for (const check of checks) {
    process.stdout.write(`${formatCheck(check)}\n`);
  }

  return checks.some((check) => check.level === "fail") ? 1 : 0;
}
