import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 内联复现 proxy 的纯函数逻辑

function uuidStringToBytes(value: string): Uint8Array {
  const hex = value.replace(/-/g, "");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createUuidV5(namespace: string, name: string): string {
  const namespaceBytes = uuidStringToBytes(namespace);
  const hash = createHash("sha1");
  hash.update(namespaceBytes);
  hash.update(name, "utf8");
  const bytes = Uint8Array.from(hash.digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function normalizeDriveLetter(value: string): string {
  return value.replace(/^[a-z]:/, (match) => match.toUpperCase());
}

function trimTrailingSlash(value: string): string {
  if (value === "/") return value;
  if (/^[A-Z]:\/$/.test(value)) return value;
  return value.replace(/\/+$/, "");
}

function normalizeWorkspacePath(cwd: string): string {
  const resolved = path.resolve(cwd);
  const slashed = normalizeDriveLetter(resolved.replace(/\\/g, "/"));
  return trimTrailingSlash(slashed);
}

const workspaceNamespaceUuid = "8b7ee9a4-2fa7-54c3-a941-8e1b8db4f4d9";

function deriveWorkspaceId(cwd: string): string {
  return createUuidV5(workspaceNamespaceUuid, normalizeWorkspacePath(cwd));
}

function deriveSessionId(threadId: string, cwd: string): string {
  return createUuidV5(
    workspaceNamespaceUuid,
    `${normalizeWorkspacePath(cwd)}::${threadId}`,
  );
}

function extractUserPrompt(inputs: unknown[]): string {
  if (!Array.isArray(inputs)) return "";
  return inputs
    .map((item: any) => {
      if (!item || typeof item !== "object") return "";
      if (item.type === "text" && typeof item.text === "string")
        return item.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function extractAssistantTextFromItem(item: any): string {
  if (!item || typeof item !== "object") return "";
  if (item.type === "agentMessage" && typeof item.text === "string")
    return item.text;
  return "";
}

function extractToolSummary(item: any): string | null {
  if (!item || typeof item !== "object") return null;
  if (item.type === "commandExecution") {
    return JSON.stringify({
      type: item.type,
      command: item.command,
      status: item.status,
      exitCode: item.exitCode,
    });
  }
  if (item.type === "mcpToolCall") {
    return JSON.stringify({
      type: item.type,
      server: item.server,
      tool: item.tool,
      status: item.status,
      error: item.error,
    });
  }
  if (item.type === "dynamicToolCall") {
    return JSON.stringify({
      type: item.type,
      tool: item.tool,
      status: item.status,
      success: item.success,
    });
  }
  return null;
}

function buildPreparedMemoryText(result: any): string {
  if (!result || typeof result !== "object") {
    return "【长期记忆】无相关历史记忆，请直接回答。";
  }

  const injection = result.injection_block;
  if (
    injection &&
    Array.isArray(injection.memory_records) &&
    injection.memory_records.length > 0
  ) {
    const lines = [
      "【长期记忆】以下信息仅在与当前问题直接相关时使用，请优先转化为答案中的约束、默认值或步骤，不要逐条转述：",
    ];
    if (injection.injection_reason) {
      lines.push(`命中原因：${injection.injection_reason}`);
    }
    if (injection.memory_summary) {
      lines.push(`可直接采用的上下文：${injection.memory_summary}`);
    }
    lines.push("可用事实：");
    for (const record of injection.memory_records) {
      const scope = record.scope ?? "";
      const type = record.memory_type ?? record.type ?? "";
      const summary =
        record.summary ?? record.content ?? JSON.stringify(record);
      lines.push(`- 记忆[${type}${scope ? "/" + scope : ""}]：${summary}`);
    }
    lines.push(
      "使用要求：如果这些记忆能帮助回答，就直接体现在最终答案里；不要单独开一段复述记忆，也不要说你看到了记忆。",
    );
    return lines.join("\n");
  }

  if (!result.trigger) {
    return "【长期记忆】无相关历史记忆，请直接回答。";
  }

  const packet = result.memory_packet;
  const records = Array.isArray(packet?.records)
    ? packet.records
    : Array.isArray(packet?.memory_records)
      ? packet.memory_records
      : [];
  if (records.length > 0) {
    return [
      "【长期记忆】以下信息仅在与当前问题直接相关时使用，请直接吸收到答案内容中：",
      ...records.map(
        (record: any) =>
          `- 记忆：${record.summary ?? record.content ?? JSON.stringify(record)}`,
      ),
      "使用要求：只保留对当前回答必要的信息，不要复述这段上下文。",
    ].join("\n");
  }

  return "【长期记忆】无相关历史记忆，请直接回答。";
}

function buildDeveloperInjectionItems(text: string): any[] {
  if (!text.trim()) return [];
  return [
    {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: text.trim() }],
    },
  ];
}

function createJsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

describe("Codex proxy bridge (memory-codex-proxy.mjs)", () => {
  describe("normalizeWorkspacePath", () => {
    it("normalizes backslashes to forward slashes", () => {
      // On Windows, path.resolve will produce backslashes
      const result = normalizeWorkspacePath("C:\\workspace\\project");
      expect(result).not.toContain("\\");
      expect(result).toMatch(/^[A-Z]:/);
    });

    it("capitalizes drive letter", () => {
      // normalizeWorkspacePath calls path.resolve first, which normalizes
      // We test the normalizeDriveLetter directly
      expect(normalizeDriveLetter("c:/workspace")).toBe("C:/workspace");
      expect(normalizeDriveLetter("d:/project")).toBe("D:/project");
    });

    it("trims trailing slashes", () => {
      expect(trimTrailingSlash("/home/user/")).toBe("/home/user");
      expect(trimTrailingSlash("/home/user////")).toBe("/home/user");
    });

    it("preserves root path", () => {
      expect(trimTrailingSlash("/")).toBe("/");
      expect(trimTrailingSlash("C:/")).toBe("C:/");
    });
  });

  describe("UUID v5 derivation", () => {
    it("deriveWorkspaceId produces deterministic UUID for same cwd", () => {
      const id1 = deriveWorkspaceId("C:/workspace/project");
      const id2 = deriveWorkspaceId("C:/workspace/project");
      expect(id1).toBe(id2);
      expect(id1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("deriveWorkspaceId produces different UUIDs for different cwds", () => {
      const id1 = deriveWorkspaceId("C:/workspace/project-a");
      const id2 = deriveWorkspaceId("C:/workspace/project-b");
      expect(id1).not.toBe(id2);
    });

    it("deriveSessionId combines threadId and cwd", () => {
      const id1 = deriveSessionId("thread-1", "C:/workspace");
      const id2 = deriveSessionId("thread-2", "C:/workspace");
      expect(id1).not.toBe(id2);
    });

    it("deriveSessionId is deterministic", () => {
      const id1 = deriveSessionId("thread-1", "C:/workspace");
      const id2 = deriveSessionId("thread-1", "C:/workspace");
      expect(id1).toBe(id2);
    });

    it("UUID v5 has correct version and variant bits", () => {
      const id = deriveWorkspaceId("C:/test");
      // Version 5: char at position 14 should be '5'
      expect(id.charAt(14)).toBe("5");
      // Variant: char at position 19 should be 8, 9, a, or b
      expect(["8", "9", "a", "b"]).toContain(id.charAt(19));
    });
  });

  describe("extractUserPrompt", () => {
    it("extracts text from input items", () => {
      const inputs = [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ];
      expect(extractUserPrompt(inputs)).toBe("Hello\nWorld");
    });

    it("skips non-text items", () => {
      const inputs = [
        { type: "image", url: "test.png" },
        { type: "text", text: "Only text" },
      ];
      expect(extractUserPrompt(inputs)).toBe("Only text");
    });

    it("returns empty string for non-array", () => {
      expect(extractUserPrompt(null as any)).toBe("");
      expect(extractUserPrompt(undefined as any)).toBe("");
    });
  });

  describe("extractAssistantTextFromItem", () => {
    it("extracts text from agentMessage item", () => {
      expect(
        extractAssistantTextFromItem({
          type: "agentMessage",
          text: "response text",
        }),
      ).toBe("response text");
    });

    it("returns empty for non-agentMessage types", () => {
      expect(extractAssistantTextFromItem({ type: "text", text: "nope" })).toBe(
        "",
      );
      expect(extractAssistantTextFromItem(null)).toBe("");
    });
  });

  describe("extractToolSummary", () => {
    it("handles commandExecution", () => {
      const item = {
        type: "commandExecution",
        command: "ls",
        status: "completed",
        exitCode: 0,
      };
      const result = JSON.parse(extractToolSummary(item)!);
      expect(result.type).toBe("commandExecution");
      expect(result.command).toBe("ls");
      expect(result.exitCode).toBe(0);
    });

    it("handles mcpToolCall", () => {
      const item = {
        type: "mcpToolCall",
        server: "memory",
        tool: "search",
        status: "success",
        error: null,
      };
      const result = JSON.parse(extractToolSummary(item)!);
      expect(result.type).toBe("mcpToolCall");
      expect(result.tool).toBe("search");
    });

    it("handles dynamicToolCall", () => {
      const item = {
        type: "dynamicToolCall",
        tool: "read_file",
        status: "done",
        success: true,
      };
      const result = JSON.parse(extractToolSummary(item)!);
      expect(result.type).toBe("dynamicToolCall");
      expect(result.success).toBe(true);
    });

    it("returns null for unrecognized types", () => {
      expect(extractToolSummary({ type: "unknown" })).toBeNull();
      expect(extractToolSummary(null)).toBeNull();
    });
  });

  describe("buildPreparedMemoryText", () => {
    it("formats full prepared memory facts for forced injection", () => {
      const prepared = {
        trigger: true,
        injection_block: {
          injection_reason: "记忆注入",
          memory_summary: "用户偏好：中文输出",
          memory_records: [
            {
              id: "mem-1",
              memory_type: "fact_preference",
              scope: "user",
              summary: "用户偏好：中文输出",
            },
          ],
        },
      };
      const text = buildPreparedMemoryText(prepared);
      const items = buildDeveloperInjectionItems(text);
      expect(items).toHaveLength(1);
      expect(items[0].role).toBe("developer");
      expect(items[0].content[0].text).toContain("命中原因：记忆注入");
      expect(items[0].content[0].text).toContain(
        "记忆[fact_preference/user]：用户偏好：中文输出",
      );
    });

    it("returns a no-memory block for null prepared result", () => {
      expect(buildPreparedMemoryText(null)).toContain("无相关历史记忆");
      expect(buildPreparedMemoryText(undefined)).toContain("无相关历史记忆");
    });

    it("returns a no-memory block when trigger is false", () => {
      expect(buildPreparedMemoryText({ trigger: false })).toContain(
        "无相关历史记忆",
      );
    });
  });

  describe("createJsonRpcError", () => {
    it("creates standard JSON-RPC error", () => {
      const error = createJsonRpcError(42, -32700, "Parse error");
      expect(error.jsonrpc).toBe("2.0");
      expect(error.id).toBe(42);
      expect(error.error.code).toBe(-32700);
      expect(error.error.message).toBe("Parse error");
    });

    it("defaults id to null when undefined", () => {
      const error = createJsonRpcError(undefined, -32000, "error");
      expect(error.id).toBeNull();
    });
  });
});
