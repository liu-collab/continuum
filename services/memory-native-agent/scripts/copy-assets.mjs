#!/usr/bin/env node

import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");

async function copyDirectory(relativeSource, relativeTarget) {
  const source = path.join(packageDir, relativeSource);
  const target = path.join(packageDir, relativeTarget);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function main() {
  await copyDirectory("src/session-store/migrations", "dist/src/session-store/migrations");
}

void main();
