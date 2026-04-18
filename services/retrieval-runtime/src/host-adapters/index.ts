import { ClaudeCodeAdapter } from "./claude-code-adapter.js";
import { CodexAppServerAdapter } from "./codex-app-server-adapter.js";
import { CustomAgentAdapter } from "./custom-agent-adapter.js";
import { MemoryNativeAgentAdapter } from "./memory-native-agent-adapter.js";

export const hostAdapters = {
  claude_code_plugin: new ClaudeCodeAdapter(),
  codex_app_server: new CodexAppServerAdapter(),
  custom_agent: new CustomAgentAdapter(),
  memory_native_agent: new MemoryNativeAgentAdapter(),
};
