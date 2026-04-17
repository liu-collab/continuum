import { createHash } from "node:crypto";

export const DEFAULT_EMBEDDING_DIMENSIONS = 1536;

export function buildDeterministicEmbedding(input, dimensions = DEFAULT_EMBEDDING_DIMENSIONS) {
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
