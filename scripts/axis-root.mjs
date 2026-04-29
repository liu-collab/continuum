import { spawn } from "node:child_process";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import process from "node:process";
import path from "node:path";

import { planCliBuild, planVendorBuild, writeBuildState } from "../packages/axis-cli/scripts/build-state.mjs";

const command = process.argv[2];
const passthroughArgs = process.argv.slice(3);

if (!command) {
  console.error("缺少命令。可用命令：start / stop / status / ui");
  process.exit(1);
}

const repoRoot = process.cwd();
const cliRoot = path.join(repoRoot, "packages", "axis-cli");
const isWindows = process.platform === "win32";
const axisHome = path.join(os.homedir(), ".axis");
const lifecycleLockPath = path.join(axisHome, "lifecycle.lock");
const sharedEnv = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/agent_memory",
  AXIS_REPO_ROOT: process.env.AXIS_REPO_ROOT ?? repoRoot,
  PLATFORM_USER_ID: process.env.PLATFORM_USER_ID ?? process.env.MNA_PLATFORM_USER_ID ?? process.env.MEMORY_USER_ID,
};

function npmCommand() {
  return isWindows ? "npm.cmd" : "npm";
}

async function removePathIfExists(targetPath) {
  await rm(targetPath, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}

function spawnCommand(commandName, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = isWindows && commandName.toLowerCase().endsWith(".cmd")
      ? spawn("cmd.exe", ["/d", "/s", "/c", commandName, ...args], {
          cwd: options.cwd ?? repoRoot,
          env: {
            ...sharedEnv,
            ...(options.env ?? {}),
          },
          stdio: "inherit",
          shell: false,
        })
      : spawn(commandName, args, {
          cwd: options.cwd ?? repoRoot,
          env: {
            ...sharedEnv,
            ...(options.env ?? {}),
          },
          stdio: "inherit",
          shell: false,
        });

    child.on("exit", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", reject);
  });
}

function hasBooleanOption(args, name) {
  return args.some((arg) => arg === `--${name}` || arg === `--${name}=true`);
}

async function isHealthy(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function managedBackendIsHealthy() {
  const storageUrl = process.env.STORAGE_API_BASE_URL ?? "http://127.0.0.1:3001";
  const runtimeUrl = process.env.RUNTIME_API_BASE_URL ?? "http://127.0.0.1:3002";
  const [storageHealthy, runtimeHealthy] = await Promise.all([
    isHealthy(`${storageUrl}/health`, 1_500),
    isHealthy(`${runtimeUrl}/healthz`, 1_500),
  ]);

  return storageHealthy && runtimeHealthy;
}

async function ensureCliBuilt() {
  const plan = await planCliBuild(cliRoot);
  if (!plan.needsBuild) {
    console.log("axis-cli 已是最新，跳过 build。");
    return;
  }

  const exitCode = await spawnCommand(npmCommand(), ["run", "build"], { cwd: cliRoot });
  if (exitCode !== 0) {
    throw new Error("axis-cli build 失败。");
  }

  await writeBuildState(plan.nextState);
}

async function prepareLatestVendor(args = []) {
  const exitCode = await spawnCommand(npmCommand(), ["run", "prepare:vendor", ...args], { cwd: cliRoot });
  if (exitCode !== 0) {
    throw new Error("axis-cli prepare:vendor 失败。");
  }
}

async function clearLocalCaches() {
  const targets = [
    path.join(cliRoot, "vendor-stage"),
    path.join(repoRoot, "services", "visualization", ".next"),
    path.join(axisHome, "stack-stage"),
  ];

  const failures = [];
  for (const target of targets) {
    try {
      await removePathIfExists(target);
    } catch (error) {
      failures.push({
        target,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`清理缓存失败: ${failure.target}`);
      console.error(failure.message);
    }
    throw new Error("stop 后缓存清理未完成。");
  }
}

async function acquireLifecycleLock() {
  await mkdir(axisHome, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const handle = await open(lifecycleLockPath, "wx").catch((error) => {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
      return null;
    });

    if (handle) {
      await handle.writeFile(String(process.pid), "utf8");
      return handle;
    }

    const existingPid = Number.parseInt((await readFile(lifecycleLockPath, "utf8").catch(() => "")).trim(), 10);
    const staleLock = Number.isFinite(existingPid) && !isProcessAlive(existingPid);
    if (staleLock) {
      await removePathIfExists(lifecycleLockPath).catch(() => undefined);
      continue;
    }

    throw new Error("已有 start/stop 命令正在执行，请等待当前生命周期操作完成。");
  }

  throw new Error("无法创建生命周期锁文件。");
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function run() {
  const needsLifecycleLock = command === "start" || command === "stop";
  const lifecycleLock = needsLifecycleLock ? await acquireLifecycleLock() : null;

  try {
    if (command === "start") {
      if (hasBooleanOption(passthroughArgs, "ui-dev")) {
        if (await managedBackendIsHealthy()) {
          console.log("--ui-dev 检测到后端已健康，跳过 vendor 刷新。");
        } else {
          await prepareLatestVendor(["--", "--skip-visualization"]);
        }
      } else {
        const vendorPlan = await planVendorBuild(cliRoot);
        if (vendorPlan.needsRefresh) {
          await prepareLatestVendor();
        } else {
          console.log("vendor 已是最新，跳过 prepare:vendor。");
        }
      }
    }

    await ensureCliBuilt();
    const exitCode = await spawnCommand(process.execPath, ["dist/src/index.js", command, ...passthroughArgs], {
      cwd: cliRoot,
    });

    if (command === "stop") {
      await clearLocalCaches().catch((error) => {
        if (exitCode === 0) {
          throw error;
        }
        console.error(error instanceof Error ? error.message : String(error));
      });
    }

    process.exitCode = exitCode;
  } finally {
    if (lifecycleLock) {
      await lifecycleLock.close().catch(() => undefined);
      await removePathIfExists(lifecycleLockPath).catch(() => undefined);
    }
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
