import { existsSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.resolve(currentDir, "../dist/src/index.js");
const sourceEntry = path.resolve(currentDir, "../src/index.ts");

async function loadEntrypoint() {
  if (existsSync(distEntry)) {
    return import(pathToFileURL(distEntry).href);
  }

  register("tsx/esm", import.meta.url);
  return import(pathToFileURL(sourceEntry).href);
}

const { start, stop } = await loadEntrypoint();

const port = Number.parseInt(process.env.MNA_PORT ?? "", 10) || 4193;
const host = process.env.MNA_HOST || "127.0.0.1";
const app = await start({ host, port });

let closing = false;

async function shutdown() {
  if (closing) {
    return;
  }

  closing = true;
  try {
    await stop(app);
  } finally {
    process.exitCode = 0;
  }
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});
