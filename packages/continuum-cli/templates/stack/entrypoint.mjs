import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";

const children = [];
const sharedEnv = {
  ...process.env,
  NODE_ENV: "production",
};
const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

function startProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: sharedEnv,
    ...options,
  });
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
}

process.on("SIGINT", stopAll);
process.on("SIGTERM", stopAll);

function buildDeterministicEmbedding(input, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
  const values = [];
  let cursor = 0;

  while (values.length < dimensions) {
    const digest = createHash("sha256")
      .update(`${input}:${cursor}`)
      .digest();

    for (const byte of digest) {
      values.push(byte / 127.5 - 1);
      if (values.length === dimensions) {
        break;
      }
    }

    cursor += 1;
  }

  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return values;
  }

  return values.map((value) => Number((value / norm).toFixed(8)));
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function runEmbeddingsServer() {
  const host = "0.0.0.0";
  const port = 31434;

  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && (request.url === "/health" || request.url === "/healthz")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "healthy" }));
        return;
      }

      if (request.method === "POST" && request.url === "/embeddings") {
        const body = await readJsonBody(request);
        const inputValue = body.input;
        const model =
          typeof body.model === "string" && body.model.trim().length > 0
            ? body.model
            : "continuum-local-embed";
        const input =
          typeof inputValue === "string"
            ? inputValue
            : Array.isArray(inputValue)
              ? inputValue.join("\n")
              : "";

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            object: "list",
            data: [
              {
                object: "embedding",
                index: 0,
                embedding: buildDeterministicEmbedding(input),
              },
            ],
            model,
            usage: {
              prompt_tokens: 0,
              total_tokens: 0,
            },
          }),
        );
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not_found" }));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  const closeServer = () => {
    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", closeServer);
  process.on("SIGTERM", closeServer);

  await new Promise((resolve, reject) => {
    server.listen(port, host, () => resolve(undefined));
    server.on("error", reject);
  });
}

async function waitForPostgresReady() {
  const deadline = Date.now() + 120_000;

  while (Date.now() < deadline) {
    const checker = spawn(
      "pg_isready",
      ["-U", process.env.POSTGRES_USER ?? "continuum", "-d", process.env.POSTGRES_DB ?? "continuum"],
      {
        stdio: "ignore",
        env: sharedEnv,
      },
    );

    const ok = await new Promise((resolve) => {
      checker.on("exit", (code) => resolve(code === 0));
      checker.on("error", () => resolve(false));
    });

    if (ok) {
      return;
    }

    await delay(1500);
  }

  throw new Error("postgres did not become ready in time");
}

async function waitForExit(child, label) {
  await new Promise((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`${label} failed`));
    });
    child.on("error", reject);
  });
}

async function main() {
  const postgres = startProcess("/usr/local/bin/docker-entrypoint.sh", ["postgres"]);
  postgres.on("exit", (code) => {
    process.exit(code ?? 1);
  });

  await waitForPostgresReady();

  const storageMigrate = startProcess(process.execPath, ["/opt/continuum/storage/dist/src/db/migrate.js"], {
    cwd: "/opt/continuum/storage",
  });
  await waitForExit(storageMigrate, "storage migration");

  const runtimeMigrate = startProcess(process.execPath, ["/opt/continuum/runtime/dist/src/db/migrate.js"], {
    cwd: "/opt/continuum/runtime",
  });
  await waitForExit(runtimeMigrate, "runtime migration");

  const embeddings = startProcess(process.execPath, ["/opt/continuum/entrypoint.mjs", "run-embeddings"], {
    cwd: "/opt/continuum",
  });
  const storage = startProcess(process.execPath, ["/opt/continuum/storage/dist/src/server.js"], {
    cwd: "/opt/continuum/storage",
    env: {
      ...sharedEnv,
      PORT: "3001",
      HOST: "0.0.0.0",
    },
  });
  const worker = startProcess(process.execPath, ["/opt/continuum/storage/dist/src/worker.js"], {
    cwd: "/opt/continuum/storage",
  });
  const runtime = startProcess(process.execPath, ["/opt/continuum/runtime/dist/src/index.js"], {
    cwd: "/opt/continuum/runtime",
    env: {
      ...sharedEnv,
      PORT: "3002",
      HOST: "0.0.0.0",
    },
  });
  const visualization = startProcess(process.execPath, ["/opt/continuum/visualization-standalone/server.js"], {
    cwd: "/opt/continuum/visualization-standalone",
    env: {
      ...sharedEnv,
      PORT: "3003",
      HOSTNAME: "0.0.0.0",
    },
  });

  for (const child of [embeddings, storage, worker, runtime, visualization]) {
    child.on("exit", () => {
      stopAll();
      postgres.kill("SIGTERM");
    });
  }
}

if (process.argv[2] === "run-embeddings") {
  await runEmbeddingsServer();
} else {
  void main().catch((error) => {
    console.error(error);
    stopAll();
    process.exit(1);
  });
}
