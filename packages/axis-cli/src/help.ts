export function renderHelp() {
  return `Axis CLI

Commands:
  axis --version
  axis version
  axis doctor             无副作用检查本机运行环境
  axis start [--open] [--daemon] [--full] [--ui-dev] [--postgres-port PORT] [--bind-host HOST] [--embedding-base-url URL] [--embedding-model MODEL] [--embedding-api-key KEY] [--memory-llm-base-url URL] [--memory-llm-model MODEL] [--memory-llm-api-key KEY] [--memory-llm-protocol PROTOCOL] [--memory-llm-effort EFFORT] [--memory-llm-timeout-ms MS] [--memory-llm-max-tokens TOKENS] [--provider-kind KIND] [--provider-model MODEL] [--provider-base-url URL] [--provider-api-key-env ENV]
  axis stop
  axis restart <runtime|storage>
  axis uninstall [--force]
  axis update
  axis status [--json] [--strict] [--runtime-url URL] [--storage-url URL] [--ui-url URL] [--database-url URL] [--timeout MS]
  axis ui [--host HOST] [--port PORT] [--open] [--url URL] [--runtime-url URL] [--storage-url URL] [--database-url URL] [--mna-url URL] [--mna-token-path PATH]
  axis mna <install|start|stop|logs|token> [--mna-url URL] [--mna-host HOST] [--mna-port PORT] [--mna-home PATH] [--provider-kind KIND] [--provider-model MODEL] [--provider-base-url URL] [--provider-api-key-env ENV] [--rotate]
  axis runtime             直接启动打包后的 retrieval-runtime
  axis runtime --full      直接启动完整 retrieval-runtime
  axis memory-model configure --base-url URL --model MODEL [--api-key KEY] [--protocol PROTOCOL] [--timeout-ms MS]
  axis memory-model status
  axis migrate --to full [--no-start] [--storage-url URL]
  axis mcp-server          直接启动打包后的记忆 MCP server
  axis claude [--plugin-dir PATH] [--package PKG]
  axis claude install [--plugin-dir PATH] [--package PKG] [--force]
  axis claude uninstall [--plugin-dir PATH]
  axis codex uninstall [--codex-home PATH] [--server-name NAME]  # cleanup legacy MCP registration
  axis codex use [--runtime-url URL] [--client-command CMD] [--app-server-command CMD] [--ensure-runtime true|false] [--codex-home PATH]
  axis codex [--runtime-url URL] [--client-command CMD] [--app-server-command CMD] [--ensure-runtime true|false] [--codex-home PATH]

Options:
  --bind-host HOST    绑定地址（默认: 127.0.0.1，仅本机访问。使用 0.0.0.0 可允许局域网访问）
  --daemon            后台运行服务，并在启动完成后提示日志查看方式
  --full              启动完整平台（Docker/Postgres/页面）；默认 axis start 为 lite runtime
  --ui-dev            仅把 visualization 切到本机 next dev，页面改动会自动热更新
  --embedding-base-url URL   第三方 embedding 接口地址，也可通过 EMBEDDING_BASE_URL 提供
  --embedding-model MODEL    第三方 embedding 模型名，也可通过 EMBEDDING_MODEL 提供
  --embedding-api-key KEY    第三方 embedding 鉴权，可选，也可通过 EMBEDDING_API_KEY 提供
  --memory-llm-base-url URL  记忆模型接口地址，也可通过 MEMORY_LLM_BASE_URL 提供
  --memory-llm-model MODEL   记忆模型名，也可通过 MEMORY_LLM_MODEL 提供
  --memory-llm-api-key KEY   记忆模型鉴权，可选，也可通过 MEMORY_LLM_API_KEY 提供
  --memory-llm-protocol PROTOCOL  记忆模型协议，支持 anthropic / openai-compatible / openai-responses / ollama
  --memory-llm-effort EFFORT      记忆模型推理强度，支持 low / medium / high / xhigh / max
  --memory-llm-timeout-ms MS      记忆模型请求超时毫秒数
  --memory-llm-max-tokens TOKENS  记忆模型最大输出 token 数
  --provider-kind KIND       mna 模型类型，支持 openai-compatible / openai-responses / anthropic / ollama
  --provider-model MODEL     mna 模型名；仅对本次启动生效，页面默认读取已保存配置
  --provider-base-url URL    mna provider 地址；仅对本次启动生效
  --provider-api-key-env ENV mna provider 鉴权环境变量名；仅对本次启动生效
`;
}
