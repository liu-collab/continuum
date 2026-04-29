import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const BUILD_STATE_VERSION = 2;
const BUILD_STATE_DIR = path.join(os.homedir(), ".continuum", "build-state");
const BUILD_STATE_PATH = path.join(BUILD_STATE_DIR, "continuum-cli.json");

function repoRootFromPackageDir(packageDir) {
  return path.resolve(packageDir, "..", "..");
}

function createDefaultBuildState() {
  return {
    version: BUILD_STATE_VERSION,
    cli: null,
    image: null,
    vendor: {
      entries: {},
      builds: {},
    },
  };
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readDirEntries(targetPath) {
  return readdir(targetPath, { withFileTypes: true });
}

async function collectFiles(baseDir, relativePath, output) {
  const absolutePath = path.join(baseDir, relativePath);
  if (!(await pathExists(absolutePath))) {
    return;
  }

  const targetStat = await stat(absolutePath);
  if (targetStat.isDirectory()) {
    const entries = await readDirEntries(absolutePath);
    const sortedEntries = entries.slice().sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of sortedEntries) {
      await collectFiles(baseDir, path.join(relativePath, entry.name), output);
    }
    return;
  }

  output.push({
    absolutePath,
    relativePath: relativePath.split(path.sep).join("/"),
  });
}

async function hashInputGroups(groups) {
  const files = [];
  for (const group of groups) {
    for (const entry of group.entries) {
      const groupFiles = [];
      await collectFiles(group.baseDir, entry, groupFiles);
      for (const file of groupFiles) {
        files.push({
          absolutePath: file.absolutePath,
          relativePath: `${group.label}/${file.relativePath}`,
        });
      }
    }
  }

  const sortedFiles = files
    .slice()
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const hash = createHash("sha256");
  for (const file of sortedFiles) {
    const content = await readFile(file.absolutePath);
    hash.update(`${file.relativePath}\n`);
    hash.update(content);
    hash.update("\n");
  }

  return hash.digest("hex");
}

async function hashInputs(baseDir, entries) {
  return hashInputGroups([{ label: ".", baseDir, entries }]);
}

async function hashStackInputs(packageDir) {
  return hashInputGroups([
    {
      label: "stack",
      baseDir: path.join(packageDir, "templates", "stack"),
      entries: ["Dockerfile", "entrypoint.mjs"],
    },
  ]);
}

function serviceDefinitions(packageDir) {
  const repoRoot = repoRootFromPackageDir(packageDir);
  return {
    storage: {
      serviceDir: path.join(repoRoot, "services", "storage"),
      buildInputs: ["src", "migrations", "package.json", "package-lock.json", "tsconfig.json", "drizzle.config.ts"],
      entryInputs: ["src", "migrations", "package.json", "package-lock.json", "tsconfig.json", "drizzle.config.ts"],
      buildOutputs: ["dist/src/server.js"],
      vendorOutputs: [
        path.join(packageDir, "vendor", "storage", "dist", "src", "server.js"),
        path.join(packageDir, "vendor", "storage", "package.json"),
      ],
    },
    runtime: {
      serviceDir: path.join(repoRoot, "services", "retrieval-runtime"),
      buildInputs: ["src", "migrations", "package.json", "package-lock.json", "tsconfig.json"],
      entryInputs: ["src", "migrations", "host-adapters", "package.json", "package-lock.json", "tsconfig.json"],
      buildOutputs: ["dist/src/index.js"],
      vendorOutputs: [
        path.join(packageDir, "vendor", "runtime", "dist", "src", "index.js"),
        path.join(packageDir, "vendor", "runtime", "package.json"),
      ],
    },
    visualization: {
      serviceDir: path.join(repoRoot, "services", "visualization"),
      buildInputs: [
        "src",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "tsconfig.typecheck.json",
        "next.config.ts",
        "next-env.d.ts",
        "postcss.config.js",
        "tailwind.config.ts",
        "components.json",
      ],
      sharedBuildInputs: [
        {
          baseDir: repoRoot,
          entries: ["docs/configuration-guide.md"],
          label: "repo",
        },
      ],
      entryInputs: [
        "src",
        "public",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "tsconfig.typecheck.json",
        "next.config.ts",
        "next-env.d.ts",
        "postcss.config.js",
        "tailwind.config.ts",
        "components.json",
      ],
      sharedEntryInputs: [
        {
          baseDir: repoRoot,
          entries: ["docs/configuration-guide.md"],
          label: "repo",
        },
      ],
      buildOutputs: [".next/standalone/server.js"],
      vendorOutputs: [path.join(packageDir, "vendor", "visualization", "standalone", "server.js")],
    },
    "memory-native-agent": {
      serviceDir: path.join(repoRoot, "services", "memory-native-agent"),
      buildInputs: ["bin", "src", "scripts", "package.json", "package-lock.json", "tsconfig.json"],
      entryInputs: ["bin", "src", "scripts", "package.json", "package-lock.json", "tsconfig.json", "README.md"],
      buildOutputs: ["dist/src/index.js"],
      vendorOutputs: [path.join(packageDir, "vendor", "memory-native-agent", "bin", "mna-server.mjs")],
    },
  };
}

async function outputsExist(baseDir, outputs) {
  for (const output of outputs) {
    if (!(await pathExists(path.isAbsolute(output) ? output : path.join(baseDir, output)))) {
      return false;
    }
  }
  return true;
}

function safeJsonParse(filePath, raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`配置文件损坏: ${filePath}\n请删除该文件后重新运行。\n${message}`);
  }
}

export async function readBuildState() {
  if (!(await pathExists(BUILD_STATE_PATH))) {
    return createDefaultBuildState();
  }

  const content = await readFile(BUILD_STATE_PATH, "utf8");
  const parsed = safeJsonParse(BUILD_STATE_PATH, content);
  if (parsed.version !== BUILD_STATE_VERSION) {
    return createDefaultBuildState();
  }
  return {
    ...createDefaultBuildState(),
    ...parsed,
    vendor: {
      ...createDefaultBuildState().vendor,
      ...(parsed.vendor ?? {}),
      entries: {
        ...createDefaultBuildState().vendor.entries,
        ...(parsed.vendor?.entries ?? {}),
      },
      builds: {
        ...createDefaultBuildState().vendor.builds,
        ...(parsed.vendor?.builds ?? {}),
      },
    },
  };
}

export async function writeBuildState(nextState) {
  await mkdir(BUILD_STATE_DIR, { recursive: true });
  await writeFile(
    BUILD_STATE_PATH,
    JSON.stringify(
      {
        version: BUILD_STATE_VERSION,
        cli: nextState.cli ?? null,
        image: nextState.image ?? null,
        vendor: {
          entries: nextState.vendor?.entries ?? {},
          builds: nextState.vendor?.builds ?? {},
        },
      },
      null,
      2,
    ),
    "utf8",
  );
}

export async function planCliBuild(packageDir) {
  const state = await readBuildState();
  const hash = await hashInputs(packageDir, ["src", "package.json", "tsconfig.json"]);
  const distReady = await outputsExist(packageDir, ["dist/src/index.js"]);

  return {
    currentState: state,
    nextState: {
      ...state,
      cli: {
        hash,
      },
    },
    hash,
    needsBuild: state.cli?.hash !== hash || !distReady,
  };
}

export async function planVendorBuild(packageDir) {
  const state = await readBuildState();
  const definitions = serviceDefinitions(packageDir);
  const serviceNames = Object.keys(definitions);
  const entryHashes = {};
  const buildHashes = {};
  const changedEntries = [];
  const buildServices = [];

  for (const serviceName of serviceNames) {
    const definition = definitions[serviceName];
    const entryHash = await hashInputGroups([
      {
        label: serviceName,
        baseDir: definition.serviceDir,
        entries: definition.entryInputs,
      },
      ...((definition.sharedEntryInputs ?? []).map((group) => ({
        ...group,
        label: `${serviceName}:${group.label}`,
      }))),
    ]);
    const buildHash = await hashInputGroups([
      {
        label: serviceName,
        baseDir: definition.serviceDir,
        entries: definition.buildInputs,
      },
      ...((definition.sharedBuildInputs ?? []).map((group) => ({
        ...group,
        label: `${serviceName}:${group.label}`,
      }))),
    ]);
    const vendorReady = await outputsExist(definition.serviceDir, definition.vendorOutputs);
    const entryChanged = state.vendor.entries?.[serviceName] !== entryHash || !vendorReady;

    entryHashes[serviceName] = entryHash;
    buildHashes[serviceName] = buildHash;

    if (!entryChanged) {
      continue;
    }

    changedEntries.push(serviceName);

    const buildOutputsReady = await outputsExist(definition.serviceDir, definition.buildOutputs);
    const buildChanged = state.vendor.builds?.[serviceName] !== buildHash;
    if (buildChanged || !buildOutputsReady) {
      buildServices.push(serviceName);
    }
  }

  const stackHash = await hashStackInputs(packageDir);
  const stackReady = await outputsExist(packageDir, [path.join(packageDir, "vendor", "stack", "Dockerfile")]);
  if (state.vendor.entries?.stack !== stackHash || !stackReady) {
    changedEntries.push("stack");
  }
  entryHashes.stack = stackHash;

  return {
    currentState: state,
    nextState: {
      ...state,
      vendor: {
        entries: {
          ...state.vendor.entries,
          ...entryHashes,
        },
        builds: {
          ...state.vendor.builds,
          ...buildHashes,
        },
      },
    },
    changedEntries,
    buildServices,
    needsRefresh: changedEntries.length > 0,
  };
}

export async function planStackImageBuild(packageDir) {
  const state = await readBuildState();
  const hash = createHash("sha256")
    .update(String(BUILD_STATE_VERSION))
    .update(state.vendor.entries.storage ?? "")
    .update(state.vendor.entries.runtime ?? "")
    .update(state.vendor.entries.visualization ?? "")
    .update(state.vendor.entries.stack ?? "")
    .digest("hex");

  const contextReady = await outputsExist(packageDir, [
    path.join(packageDir, "vendor", "storage", "dist", "src", "server.js"),
    path.join(packageDir, "vendor", "storage", "dist", "src", "worker.js"),
    path.join(packageDir, "vendor", "storage", "migrations"),
    path.join(packageDir, "vendor", "storage", "node_modules"),
    path.join(packageDir, "vendor", "storage", "package.json"),
    path.join(packageDir, "vendor", "runtime", "dist", "src", "index.js"),
    path.join(packageDir, "vendor", "runtime", "migrations"),
    path.join(packageDir, "vendor", "runtime", "node_modules"),
    path.join(packageDir, "vendor", "runtime", "host-adapters", "memory-claude-plugin"),
    path.join(packageDir, "vendor", "runtime", "package.json"),
    path.join(packageDir, "vendor", "visualization", "standalone", "server.js"),
    path.join(packageDir, "vendor", "visualization", "standalone", "package.json"),
    path.join(packageDir, "vendor", "stack", "Dockerfile"),
    path.join(packageDir, "vendor", "stack", "entrypoint.mjs"),
  ]);

  return {
    currentState: state,
    nextState: {
      ...state,
      image: {
        hash,
      },
    },
    hash,
    needsBuild: state.image?.hash !== hash || !contextReady,
  };
}
