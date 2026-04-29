import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { loadBuildStateHelpers } from "./build-state-loader.js";
import { npmCommand, runForeground } from "./managed-process.js";
import { pathExists, vendorPath } from "./utils.js";

type BuildStateHelpers = Awaited<ReturnType<typeof loadBuildStateHelpers>>;

async function copyVisualizationVendorBundle(packageRoot: string) {
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const visualizationDir = path.join(repoRoot, "services", "visualization");
  const standaloneSource = path.join(visualizationDir, ".next", "standalone");
  const staticSource = path.join(visualizationDir, ".next", "static");
  const publicSource = path.join(visualizationDir, "public");
  const visualizationVendorDir = vendorPath(packageRoot, "visualization");
  const targetDir = path.join(visualizationVendorDir, "standalone");

  await rm(visualizationVendorDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await cp(standaloneSource, targetDir, { recursive: true });
  await cp(staticSource, path.join(targetDir, ".next", "static"), { recursive: true });
  if (await pathExists(publicSource)) {
    await cp(publicSource, path.join(targetDir, "public"), { recursive: true });
  }
}

export async function refreshVisualizationVendor(
  packageRoot: string,
  buildState: BuildStateHelpers,
) {
  const vendorPlan = await buildState.planVendorBuild(packageRoot);
  const visualizationChanged = vendorPlan.changedEntries.includes("visualization");
  const visualizationNeedsBuild = vendorPlan.buildServices.includes("visualization");

  if (!visualizationChanged) {
    return {
      refreshed: false,
    };
  }

  process.stdout.write("检测到 visualization 变更，正在刷新前端产物...\n");
  if (visualizationNeedsBuild) {
    const repoRoot = path.resolve(packageRoot, "..", "..");
    const visualizationDir = path.join(repoRoot, "services", "visualization");
    await rm(path.join(visualizationDir, ".next"), { recursive: true, force: true }).catch(() => undefined);
    await runForeground(npmCommand(), ["run", "build"], visualizationDir);
  }
  await copyVisualizationVendorBundle(packageRoot);
  await buildState.writeBuildState({
    ...vendorPlan.currentState,
    vendor: {
      entries: {
        ...vendorPlan.currentState.vendor.entries,
        visualization: vendorPlan.nextState.vendor.entries.visualization,
      },
      builds: {
        ...vendorPlan.currentState.vendor.builds,
        visualization: vendorPlan.nextState.vendor.builds.visualization,
      },
    },
  });

  return {
    refreshed: true,
    visualizationNeedsBuild,
  };
}

async function copyMemoryNativeAgentVendorBundle(packageRoot: string) {
  const repoRoot = path.resolve(packageRoot, "..", "..");
  const sourceDir = path.join(repoRoot, "services", "memory-native-agent");
  const targetDir = vendorPath(packageRoot, "memory-native-agent");

  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });
  await cp(path.join(sourceDir, "bin"), path.join(targetDir, "bin"), { recursive: true });
  await cp(path.join(sourceDir, "dist"), path.join(targetDir, "dist"), { recursive: true });
  await cp(path.join(sourceDir, "node_modules"), path.join(targetDir, "node_modules"), { recursive: true });
  await cp(path.join(sourceDir, "package.json"), path.join(targetDir, "package.json"));
  if (await pathExists(path.join(sourceDir, "README.md"))) {
    await cp(path.join(sourceDir, "README.md"), path.join(targetDir, "README.md"));
  }
}

export async function refreshMemoryNativeAgentVendor(
  packageRoot: string,
  buildState: BuildStateHelpers,
) {
  const vendorPlan = await buildState.planVendorBuild(packageRoot);
  const changed = vendorPlan.changedEntries.includes("memory-native-agent");
  const needsBuild = vendorPlan.buildServices.includes("memory-native-agent");

  if (!changed) {
    return {
      refreshed: false,
    };
  }

  process.stdout.write("检测到 memory-native-agent 变更，正在刷新 MNA 产物...\n");
  if (needsBuild) {
    const repoRoot = path.resolve(packageRoot, "..", "..");
    const serviceDir = path.join(repoRoot, "services", "memory-native-agent");
    await runForeground(npmCommand(), ["run", "build"], serviceDir);
  }
  await copyMemoryNativeAgentVendorBundle(packageRoot);
  await buildState.writeBuildState({
    ...vendorPlan.currentState,
    vendor: {
      entries: {
        ...vendorPlan.currentState.vendor.entries,
        "memory-native-agent": vendorPlan.nextState.vendor.entries["memory-native-agent"],
      },
      builds: {
        ...vendorPlan.currentState.vendor.builds,
        "memory-native-agent": vendorPlan.nextState.vendor.builds["memory-native-agent"],
      },
    },
  });

  return {
    refreshed: true,
    needsBuild,
  };
}
