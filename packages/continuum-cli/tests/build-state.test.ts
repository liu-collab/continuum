import os from "node:os";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function writeFixtureFile(filePath: string, content = "") {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

async function createCliFixture(rootDir: string) {
  const packageDir = path.join(rootDir, "packages", "continuum-cli");
  await writeFixtureFile(path.join(packageDir, "src", "index.ts"), "export const cli = true;\n");
  await writeFixtureFile(path.join(packageDir, "package.json"), "{\"name\":\"cli\"}\n");
  await writeFixtureFile(path.join(packageDir, "tsconfig.json"), "{\"compilerOptions\":{}}\n");
  await writeFixtureFile(path.join(packageDir, "dist", "src", "index.js"), "export {};\n");
  return packageDir;
}

async function createVendorFixture(rootDir: string) {
  const packageDir = await createCliFixture(rootDir);
  const templatesDir = path.join(packageDir, "templates", "stack");
  const servicesRoot = path.join(rootDir, "services");
  const vendorRoot = path.join(packageDir, "vendor");

  await writeFixtureFile(path.join(templatesDir, "Dockerfile"), "FROM node:22\n");
  await writeFixtureFile(path.join(templatesDir, "entrypoint.mjs"), "console.log('entry');\n");

  await writeFixtureFile(path.join(servicesRoot, "storage", "src", "index.ts"), "export const storage = 1;\n");
  await writeFixtureFile(path.join(servicesRoot, "storage", "migrations", "001.sql"), "-- storage\n");
  await writeFixtureFile(path.join(servicesRoot, "storage", "package.json"), "{\"name\":\"storage\"}\n");
  await writeFixtureFile(path.join(servicesRoot, "storage", "package-lock.json"), "{\"lockfileVersion\":3}\n");
  await writeFixtureFile(path.join(servicesRoot, "storage", "tsconfig.json"), "{\"compilerOptions\":{}}\n");
  await writeFixtureFile(path.join(servicesRoot, "storage", "drizzle.config.ts"), "export {};\n");
  await writeFixtureFile(path.join(servicesRoot, "storage", "dist", "src", "server.js"), "export {};\n");

  await writeFixtureFile(path.join(servicesRoot, "retrieval-runtime", "src", "index.ts"), "export const runtime = 1;\n");
  await writeFixtureFile(path.join(servicesRoot, "retrieval-runtime", "migrations", "001.sql"), "-- runtime\n");
  await writeFixtureFile(path.join(servicesRoot, "retrieval-runtime", "host-adapters", "adapter.ts"), "export {};\n");
  await writeFixtureFile(path.join(servicesRoot, "retrieval-runtime", "package.json"), "{\"name\":\"runtime\"}\n");
  await writeFixtureFile(path.join(servicesRoot, "retrieval-runtime", "package-lock.json"), "{\"lockfileVersion\":3}\n");
  await writeFixtureFile(path.join(servicesRoot, "retrieval-runtime", "tsconfig.json"), "{\"compilerOptions\":{}}\n");
  await writeFixtureFile(path.join(servicesRoot, "retrieval-runtime", "dist", "src", "index.js"), "export {};\n");

  await writeFixtureFile(path.join(servicesRoot, "visualization", "src", "page.tsx"), "export default function Page() { return null; }\n");
  await writeFixtureFile(path.join(servicesRoot, "visualization", "public", "logo.txt"), "logo\n");
  await writeFixtureFile(path.join(servicesRoot, "visualization", "package.json"), "{\"name\":\"visualization\"}\n");
  await writeFixtureFile(path.join(servicesRoot, "visualization", "package-lock.json"), "{\"lockfileVersion\":3}\n");
  await writeFixtureFile(path.join(servicesRoot, "visualization", "tsconfig.json"), "{\"compilerOptions\":{}}\n");
  await writeFixtureFile(path.join(servicesRoot, "visualization", "tsconfig.typecheck.json"), "{\"extends\":\"./tsconfig.json\"}\n");
  await writeFixtureFile(path.join(servicesRoot, "visualization", "next.config.ts"), "export default {};\n");
  await writeFixtureFile(path.join(servicesRoot, "visualization", "next-env.d.ts"), "/// <reference types=\"next\" />\n");
  await writeFixtureFile(path.join(servicesRoot, "visualization", "postcss.config.js"), "module.exports = {};\n");
  await writeFixtureFile(path.join(servicesRoot, "visualization", "tailwind.config.ts"), "export default {};\n");
  await writeFixtureFile(path.join(servicesRoot, "visualization", "components.json"), "{}\n");
  await writeFixtureFile(path.join(servicesRoot, "visualization", ".next", "standalone", "server.js"), "export {};\n");

  await writeFixtureFile(path.join(servicesRoot, "memory-native-agent", "bin", "mna-server.mjs"), "console.log('mna');\n");
  await writeFixtureFile(path.join(servicesRoot, "memory-native-agent", "src", "index.ts"), "export const mna = 1;\n");
  await writeFixtureFile(path.join(servicesRoot, "memory-native-agent", "scripts", "copy-assets.mjs"), "console.log('copy');\n");
  await writeFixtureFile(path.join(servicesRoot, "memory-native-agent", "package.json"), "{\"name\":\"mna\"}\n");
  await writeFixtureFile(path.join(servicesRoot, "memory-native-agent", "package-lock.json"), "{\"lockfileVersion\":3}\n");
  await writeFixtureFile(path.join(servicesRoot, "memory-native-agent", "tsconfig.json"), "{\"compilerOptions\":{}}\n");
  await writeFixtureFile(path.join(servicesRoot, "memory-native-agent", "README.md"), "readme\n");
  await writeFixtureFile(path.join(servicesRoot, "memory-native-agent", "dist", "src", "index.js"), "export {};\n");

  await writeFixtureFile(path.join(vendorRoot, "storage", "dist", "src", "server.js"), "export {};\n");
  await writeFixtureFile(path.join(vendorRoot, "runtime", "dist", "src", "index.js"), "export {};\n");
  await writeFixtureFile(path.join(vendorRoot, "visualization", "standalone", "server.js"), "export {};\n");
  await writeFixtureFile(path.join(vendorRoot, "memory-native-agent", "bin", "mna-server.mjs"), "console.log('mna');\n");
  await writeFixtureFile(path.join(vendorRoot, "stack", "Dockerfile"), "FROM node:22\n");

  return packageDir;
}

describe("build state planning", () => {
  const tempHome = path.join(os.tmpdir(), `continuum-build-state-${Date.now()}`);
  let previousHome: string | undefined;
  let previousUserProfile: string | undefined;

  beforeEach(async () => {
    previousHome = process.env.HOME;
    previousUserProfile = process.env.USERPROFILE;
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    await rm(tempHome, { recursive: true, force: true });
    await mkdir(tempHome, { recursive: true });
    vi.resetModules();
  });

  afterEach(async () => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = previousUserProfile;
    }
    await rm(tempHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("skips cli rebuild when inputs and dist outputs are unchanged", async () => {
    const rootDir = path.join(tempHome, "repo");
    const packageDir = await createCliFixture(rootDir);
    // @ts-expect-error helper script is executed directly and not part of the package ts build graph
    const { planCliBuild, writeBuildState } = await import("../scripts/build-state.mjs");

    const initialPlan = await planCliBuild(packageDir);
    expect(initialPlan.needsBuild).toBe(true);

    await writeBuildState(initialPlan.nextState);

    const steadyPlan = await planCliBuild(packageDir);
    expect(steadyPlan.needsBuild).toBe(false);

    await writeFixtureFile(path.join(packageDir, "src", "index.ts"), "export const cli = 2;\n");
    const changedPlan = await planCliBuild(packageDir);
    expect(changedPlan.needsBuild).toBe(true);
  });

  it("only rebuilds changed vendor services and skips visualization rebuild for public-only changes", async () => {
    const rootDir = path.join(tempHome, "repo");
    const packageDir = await createVendorFixture(rootDir);
    // @ts-expect-error helper script is executed directly and not part of the package ts build graph
    const { planVendorBuild, writeBuildState } = await import("../scripts/build-state.mjs");

    const initialPlan = await planVendorBuild(packageDir);
    expect(initialPlan.needsRefresh).toBe(true);

    await writeBuildState(initialPlan.nextState);

    const steadyPlan = await planVendorBuild(packageDir);
    expect(steadyPlan.needsRefresh).toBe(false);
    expect(steadyPlan.changedEntries).toEqual([]);
    expect(steadyPlan.buildServices).toEqual([]);

    await writeFixtureFile(path.join(rootDir, "services", "storage", "src", "index.ts"), "export const storage = 2;\n");
    const storagePlan = await planVendorBuild(packageDir);
    expect(storagePlan.changedEntries).toContain("storage");
    expect(storagePlan.buildServices).toContain("storage");

    await writeBuildState(storagePlan.nextState);
    await writeFixtureFile(path.join(rootDir, "services", "visualization", "public", "logo.txt"), "logo-v2\n");
    const publicOnlyPlan = await planVendorBuild(packageDir);
    expect(publicOnlyPlan.changedEntries).toContain("visualization");
    expect(publicOnlyPlan.buildServices).not.toContain("visualization");
  });
});
