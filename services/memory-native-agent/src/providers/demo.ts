import type { ChatChunk, ChatMessage, ChatRequest, IModelProvider, ToolCall } from "./types.js";

type DemoProviderOptions = {
  model: string;
};

export class DemoProvider implements IModelProvider {
  constructor(private readonly options: DemoProviderOptions) {}

  id(): string {
    return "demo";
  }

  model(): string {
    return this.options.model;
  }

  async *chat(request: ChatRequest): AsyncIterable<ChatChunk> {
    const lastUserMessage = [...request.messages]
      .reverse()
      .find((message) => message.role === "user")?.content ?? "";
    const toolMessages = request.messages.filter((message) => message.role === "tool");
    const memoryBlock = request.messages
      .filter((message) => message.role === "system" && message.content.includes("<memory_injection"))
      .map((message) => message.content)
      .join("\n");

    const normalizedInput = lastUserMessage.toLowerCase();

    if (!toolMessages.length && request.tools?.length) {
      const plannedTool = decideToolCall(normalizedInput, request.messages);
      if (plannedTool) {
        yield {
          type: "tool_call",
          call: plannedTool,
        };
        yield {
          type: "end",
          finish_reason: "tool_use",
          usage: {
            prompt_tokens: 24,
            completion_tokens: 8,
          },
        };
        return;
      }
    }

    const toolSummary = toolMessages.at(-1)?.content ?? "";
    const answer = buildDemoAnswer({
      input: lastUserMessage,
      normalizedInput,
      memoryBlock,
      toolSummary,
    });

    for (const chunk of chunkText(answer, 32)) {
      yield {
        type: "text_delta",
        text: chunk,
      };
    }

    yield {
      type: "end",
      finish_reason: "stop",
      usage: {
        prompt_tokens: 48,
        completion_tokens: Math.max(8, Math.ceil(answer.length / 8)),
      },
    };
  }
}

function decideToolCall(normalizedInput: string, messages: ChatMessage[]): ToolCall | null {
  if (normalizedInput.includes("读取") || normalizedInput.includes("readme")) {
    return {
      id: "demo-tool-read",
      name: "fs_read",
      args: {
        path: "README.md",
      },
    };
  }

  if (normalizedInput.includes("写入") || normalizedInput.includes("创建文件")) {
    return {
      id: "demo-tool-write",
      name: "fs_write",
      args: {
        path: "demo-note.txt",
        content: "这是 Continuum demo provider 写入的示例内容。\n",
      },
    };
  }

  if (normalizedInput.includes("命令") || normalizedInput.includes("pwd") || normalizedInput.includes("目录")) {
    const usedShell = messages.some((message) => message.role === "tool" && message.content.includes('tool="shell_exec"'));
    if (!usedShell) {
      return {
        id: "demo-tool-shell",
        name: "shell_exec",
        args: {
          command: process.platform === "win32" ? "cd" : "pwd",
          description: "show current workspace path",
        },
      };
    }
  }

  return null;
}

function buildDemoAnswer(input: {
  input: string;
  normalizedInput: string;
  memoryBlock: string;
  toolSummary: string;
}) {
  if (input.toolSummary) {
    if (input.toolSummary.includes('tool="fs_read"')) {
      return "我已经读取了 README.md，内容预览已经返回到页面里。";
    }
    if (input.toolSummary.includes('tool="fs_write"')) {
      return "我已经准备写入文件，等你确认后就会把内容写到工作区。";
    }
    if (input.toolSummary.includes('tool="shell_exec"')) {
      return "命令执行结果已经返回，工具控制台里可以看到输出摘要。";
    }
  }

  if (input.normalizedInput.includes("我偏好什么")) {
    if (input.memoryBlock.toLowerCase().includes("typescript")) {
      return "你偏好使用 TypeScript。";
    }
    return "当前没有恢复到相关偏好。";
  }

  if (input.normalizedInput.includes("请记住") || input.normalizedInput.includes("偏好")) {
    return "已确认，我会记住你偏好使用 TypeScript。";
  }

  if (input.normalizedInput.includes("读取") || input.normalizedInput.includes("readme")) {
    return "我准备先读取 README.md，再把结果整理给你。";
  }

  if (input.normalizedInput.includes("写入") || input.normalizedInput.includes("创建文件")) {
    return "我准备创建一个示例文件，这一步会触发确认弹窗。";
  }

  if (input.normalizedInput.includes("命令") || input.normalizedInput.includes("pwd") || input.normalizedInput.includes("目录")) {
    return "我准备执行一个只读命令来查看当前目录，这一步会触发确认弹窗。";
  }

  return `已收到：${input.input}`;
}

function chunkText(text: string, size: number) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks.length > 0 ? chunks : [text];
}
