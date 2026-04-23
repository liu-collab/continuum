import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTools,
  handleLine,
} from "../host-adapters/memory-codex-adapter/mcp/memory-mcp-server.mjs";

describe("Codex MCP Server (memory-mcp-server.mjs)", () => {
  describe("createTools", () => {
    it("returns 4 tool definitions", () => {
      const tools = createTools("http://localhost:3002");
      const names = Object.keys(tools);
      expect(names).toContain("memory_dependency_status");
      expect(names).toContain("memory_trace_turn");
      expect(names).toContain("memory_search");
      expect(names).toContain("memory_explain_hit");
      expect(names).toHaveLength(4);
    });

    it("each tool has description and inputSchema", () => {
      const tools = createTools("http://localhost:3002");
      for (const [name, tool] of Object.entries(tools)) {
        expect(tool).toHaveProperty("description");
        expect(typeof (tool as any).description).toBe("string");
        expect(tool).toHaveProperty("inputSchema");
        expect(typeof (tool as any).inputSchema).toBe("object");
        expect(tool).toHaveProperty("run");
        expect(typeof (tool as any).run).toBe("function");
      }
    });

    it("memory_search inputSchema requires query field", () => {
      const tools = createTools("http://localhost:3002");
      const schema = (tools as any).memory_search.inputSchema;
      expect(schema.required).toContain("query");
    });

    it("memory_explain_hit inputSchema requires trace_id field", () => {
      const tools = createTools("http://localhost:3002");
      const schema = (tools as any).memory_explain_hit.inputSchema;
      expect(schema.required).toContain("trace_id");
    });
  });

  describe("handleLine JSON-RPC protocol", () => {
    let writtenMessages: any[];
    const originalWrite = process.stdout.write;

    beforeEach(() => {
      writtenMessages = [];
      process.stdout.write = ((chunk: any) => {
        if (typeof chunk === "string") {
          const trimmed = chunk.trim();
          if (trimmed) {
            try {
              writtenMessages.push(JSON.parse(trimmed));
            } catch {
              // ignore non-JSON
            }
          }
        }
        return true;
      }) as any;
    });

    afterEach(() => {
      process.stdout.write = originalWrite;
    });

    it("responds to initialize with protocol version and capabilities", async () => {
      await handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {},
        }),
      );

      expect(writtenMessages).toHaveLength(1);
      const msg = writtenMessages[0];
      expect(msg.id).toBe(1);
      expect(msg.result.protocolVersion).toBe("2024-11-05");
      expect(msg.result.serverInfo.name).toBe("memory-codex-bridge");
      expect(msg.result.capabilities.tools).toBeDefined();
    });

    it("responds to tools/list with all tool definitions", async () => {
      await handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        }),
      );

      expect(writtenMessages).toHaveLength(1);
      const msg = writtenMessages[0];
      expect(msg.id).toBe(2);
      expect(msg.result.tools).toHaveLength(4);
      const toolNames = msg.result.tools.map((t: any) => t.name);
      expect(toolNames).toContain("memory_dependency_status");
      expect(toolNames).toContain("memory_trace_turn");
      expect(toolNames).toContain("memory_search");
      expect(toolNames).toContain("memory_explain_hit");
    });

    it("ignores notifications/initialized silently", async () => {
      await handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
          params: {},
        }),
      );

      // Should not write any response
      expect(writtenMessages).toHaveLength(0);
    });

    it("returns error for unsupported method", async () => {
      await handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "unknown/method",
          params: {},
        }),
      );

      expect(writtenMessages).toHaveLength(1);
      const msg = writtenMessages[0];
      expect(msg.id).toBe(3);
      expect(msg.error).toBeDefined();
      expect(msg.error.code).toBe(-32601);
      expect(msg.error.message).toContain("unsupported method");
    });

    it("returns error for tools/call with unknown tool name", async () => {
      await handleLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "nonexistent_tool", arguments: {} },
        }),
      );

      expect(writtenMessages).toHaveLength(1);
      const msg = writtenMessages[0];
      expect(msg.id).toBe(4);
      expect(msg.error).toBeDefined();
      expect(msg.error.message).toContain("unknown tool");
    });

    it("skips empty lines", async () => {
      await handleLine("");
      await handleLine("   ");
      expect(writtenMessages).toHaveLength(0);
    });

    it("calls memory_dependency_status tool via tools/call", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => ({
        ok: true,
        json: async () => ({
          read_model: { status: "healthy" },
          embeddings: { status: "healthy" },
        }),
      })) as any;

      try {
        await handleLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 5,
            method: "tools/call",
            params: { name: "memory_dependency_status", arguments: {} },
          }),
        );

        expect(writtenMessages).toHaveLength(1);
        const msg = writtenMessages[0];
        expect(msg.id).toBe(5);
        expect(msg.result).toBeDefined();
        expect(msg.result.content).toHaveLength(1);
        expect(msg.result.content[0].type).toBe("text");
        const payload = JSON.parse(msg.result.content[0].text);
        expect(payload.read_model.status).toBe("healthy");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
