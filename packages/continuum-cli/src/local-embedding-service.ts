import { createServer } from "node:http";
import process from "node:process";

import { buildDeterministicEmbedding, DEFAULT_EMBEDDING_DIMENSIONS } from "./shared-embedding.js";

export const DEFAULT_LOCAL_EMBEDDING_PORT = 31434;

async function readJsonBody(request: NodeJS.ReadableStream) {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

export async function runLocalEmbeddingsServiceCommand(
  options: Record<string, string | boolean>,
) {
  const host = typeof options.host === "string" ? options.host : "127.0.0.1";
  const port =
    typeof options.port === "string" ? Number(options.port) : DEFAULT_LOCAL_EMBEDDING_PORT;

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

        const embedding = buildDeterministicEmbedding(input);

        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            object: "list",
            data: [
              {
                object: "embedding",
                index: 0,
                embedding,
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

  await new Promise<void>((resolve, reject) => {
    server.listen(port, host, () => resolve());
    server.on("error", reject);
  });

  process.stdout.write(`local embeddings service listening on http://${host}:${port}\n`);
}
