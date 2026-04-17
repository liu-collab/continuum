#!/usr/bin/env node

import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");

const requiredPaths = [
  path.join(packageDir, "vendor", "storage", "dist", "src", "server.js"),
  path.join(packageDir, "vendor", "storage", "dist", "src", "worker.js"),
  path.join(packageDir, "vendor", "storage", "migrations"),
  path.join(packageDir, "vendor", "storage", "node_modules"),
  path.join(packageDir, "vendor", "runtime", "dist", "src", "index.js"),
  path.join(packageDir, "vendor", "runtime", "migrations"),
  path.join(packageDir, "vendor", "runtime", "node_modules"),
  path.join(packageDir, "vendor", "runtime", "host-adapters", "memory-claude-plugin"),
  path.join(packageDir, "vendor", "visualization", "standalone", "server.js"),
  path.join(packageDir, "vendor", "stack", "Dockerfile"),
  path.join(packageDir, "vendor", "stack", "entrypoint.mjs"),
  path.join(packageDir, "vendor", "stack", "storage-src", "package.json"),
  path.join(packageDir, "vendor", "stack", "runtime-src", "package.json"),
  path.join(packageDir, "vendor", "stack", "visualization-src", "package.json"),
];

async function ensurePath(targetPath) {
  try {
    await access(targetPath);
  } catch {
    throw new Error(
      `vendor artifact missing: ${targetPath}. Run "npm run prepare:vendor" first.`,
    );
  }
}

async function main() {
  for (const targetPath of requiredPaths) {
    await ensurePath(targetPath);
  }
}

void main();
