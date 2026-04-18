import { Readable } from "node:stream";

import Fastify, { type FastifyInstance } from "fastify";

export async function startProviderMock(register: (app: FastifyInstance) => void | Promise<void>) {
  const app = Fastify({ logger: false });
  await register(app);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("mock server address unavailable");
  }

  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

export function sseStream(chunks: string[]) {
  return Readable.from(chunks, { objectMode: false });
}

export function ndjsonStream(chunks: string[]) {
  return Readable.from(chunks, { objectMode: false });
}

export async function collectChunks<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const chunks: T[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return chunks;
}
