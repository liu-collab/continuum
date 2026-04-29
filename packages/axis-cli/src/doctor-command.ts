import { statfs } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { readManagedEmbeddingConfig } from "./managed-config.js";
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
    detail: dockerInstallHint(process.platform),
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
    detail: dockerStartHint(process.platform),
  };
}

function dockerInstallHint(platform: NodeJS.Platform) {
  if (platform === "win32") {
    return bilingualMessage(
      "可运行 axis start 并按提示通过 winget 安装，或手动安装 Docker Desktop。",
      "Run axis start and follow the winget prompt, or install Docker Desktop manually.",
    );
  }

  if (platform === "darwin") {
    return bilingualMessage(
      "请执行 `brew install --cask docker`，或从 Docker 官网安装 Docker Desktop。",
      "Run `brew install --cask docker`, or install Docker Desktop from Docker manually.",
    );
  }

  if (platform === "linux") {
    return bilingualMessage(
      "请按发行版安装 Docker Engine，例如 apt: `sudo apt-get install -y docker.io`，dnf/yum: `sudo dnf install -y docker`。",
      "Install Docker Engine for your distribution, for example apt: `sudo apt-get install -y docker.io`, dnf/yum: `sudo dnf install -y docker`.",
    );
  }

  return bilingualMessage(
    "请安装 Docker 后重试。",
    "Install Docker, then retry.",
  );
}

function dockerStartHint(platform: NodeJS.Platform) {
  if (platform === "linux") {
    return bilingualMessage(
      "可尝试执行 `sudo systemctl start docker`，并确认当前用户可执行 docker version。",
      "Try `sudo systemctl start docker`, and make sure this user can run docker version.",
    );
  }

  return bilingualMessage(
    "可先打开 Docker Desktop，或直接运行 axis start 让 CLI 尝试启动。",
    "Open Docker Desktop first, or run axis start and let the CLI try to start it.",
  );
}

function portHint(port: number) {
  if (port === DEFAULT_MANAGED_POSTGRES_PORT) {
    return bilingualMessage(
      "可用 `axis start --postgres-port PORT` 指定其他数据库端口。",
      "Use `axis start --postgres-port PORT` to choose another database port.",
    );
  }

  if (port === DEFAULT_STORAGE_PORT) {
    return bilingualMessage(
      "可设置 STORAGE_PORT 环境变量改用其他 storage 端口。",
      "Set the STORAGE_PORT environment variable to use another storage port.",
    );
  }

  if (port === DEFAULT_RUNTIME_PORT) {
    return bilingualMessage(
      "可设置 RUNTIME_PORT 环境变量改用其他 runtime 端口。",
      "Set the RUNTIME_PORT environment variable to use another runtime port.",
    );
  }

  if (port === DEFAULT_VISUALIZATION_PORT) {
    return bilingualMessage(
      "可设置 UI_PORT 或 VISUALIZATION_PORT 环境变量改用其他页面端口。",
      "Set the UI_PORT or VISUALIZATION_PORT environment variable to use another UI port.",
    );
  }

  return bilingualMessage(
    "请释放该端口后重试。",
    "Free this port, then retry.",
  );
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
        detail: portHint(port),
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

async function checkEmbeddingConfig(): Promise<DoctorCheck> {
  const managed = await readManagedEmbeddingConfig().catch(() => null);
  const hasConfig = Boolean(
    (managed?.baseUrl && managed.model)
    || (process.env.EMBEDDING_BASE_URL?.trim() && process.env.EMBEDDING_MODEL?.trim()),
  );

  return hasConfig
    ? {
        level: "ok",
        label: bilingualMessage(
          "已配置 embedding",
          "Embedding is configured",
        ),
      }
    : {
        level: "warn",
        label: bilingualMessage(
          "未检测到 embedding 配置，记忆检索会降级；可启动后在 Agent 设置面板中配置。",
          "Embedding config was not detected, so memory retrieval will be degraded. Configure it in the Agent settings panel after startup.",
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
    await checkEmbeddingConfig(),
    await checkDiskSpace(),
  ];

  process.stdout.write("Axis doctor\n");
  for (const check of checks) {
    process.stdout.write(`${formatCheck(check)}\n`);
  }

  return checks.some((check) => check.level === "fail") ? 1 : 0;
}
