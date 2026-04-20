import { describe, expect, it } from "vitest";

import { streamLines } from "../shared.js";

function createReadableStream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("streamLines", () => {
  it("joins partial lines split across chunks", async () => {
    const lines: string[] = [];

    for await (const line of streamLines(
      createReadableStream([
        "data: {\"choices\":[{\"delta\":{\"content\":\"hel",
        "lo\"}}]}\n",
        "data: [DONE]\n",
      ]),
    )) {
      lines.push(line);
    }

    expect(lines).toEqual([
      "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}",
      "data: [DONE]",
    ]);
  });

  it("keeps multibyte utf8 characters intact when bytes are split", async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode("data: 你好\n");
    const first = bytes.subarray(0, 8);
    const second = bytes.subarray(8);

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(second);
        controller.close();
      },
    });

    const lines: string[] = [];
    for await (const line of streamLines(stream)) {
      lines.push(line);
    }

    expect(lines).toEqual(["data: 你好"]);
  });
});
