import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const isWindows = process.platform === "win32";
const npmExecutable = isWindows ? "npm.cmd" : "npm";
const buildPlatformUserId =
  process.env.PLATFORM_USER_ID
  ?? process.env.MNA_PLATFORM_USER_ID
  ?? process.env.MEMORY_USER_ID
  ?? "550e8400-e29b-41d4-a716-446655440000";

const packages = [
  "services/storage",
  "services/retrieval-runtime",
  "services/memory-native-agent",
  "services/visualization",
  "packages/axis-cli",
];

function runBuild(packagePath) {
  return new Promise((resolve, reject) => {
    const options = {
      cwd: path.join(repoRoot, packagePath),
      env: {
        ...process.env,
        PLATFORM_USER_ID: buildPlatformUserId,
      },
      stdio: "inherit",
      shell: false,
    };
    const child = isWindows
      ? spawn("cmd.exe", ["/d", "/s", "/c", npmExecutable, "run", "build"], options)
      : spawn(npmExecutable, ["run", "build"], options);

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${packagePath} build failed with exit code ${code ?? 1}`));
    });
    child.on("error", reject);
  });
}

for (const packagePath of packages) {
  process.stdout.write(`\n> build ${packagePath}\n`);
  await runBuild(packagePath);
}
