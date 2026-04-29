export function renderHelp() {
  return `Axis CLI

Commands:
  axis --version
  axis start [--open] [--ui-dev] [--postgres-port PORT] [--bind-host HOST] [--embedding-base-url URL] [--embedding-model MODEL] [--embedding-api-key KEY] [--provider-kind KIND] [--provider-model MODEL] [--provider-base-url URL] [--provider-api-key-env ENV]
  axis stop
  axis status [--json] [--strict] [--runtime-url URL] [--storage-url URL] [--ui-url URL] [--database-url URL] [--timeout MS]
  axis ui [--host HOST] [--port PORT] [--open] [--url URL] [--runtime-url URL] [--storage-url URL] [--database-url URL] [--mna-url URL] [--mna-token-path PATH]
  axis mna <install|start|stop|logs|token> [--mna-url URL] [--mna-host HOST] [--mna-port PORT] [--mna-home PATH] [--provider-kind KIND] [--provider-model MODEL] [--provider-base-url URL] [--provider-api-key-env ENV] [--rotate]
  axis claude install [--plugin-dir PATH] [--package PKG] [--force]
  axis claude uninstall [--plugin-dir PATH]
  axis codex install [--runtime-url URL] [--codex-home PATH]
  axis codex uninstall [--codex-home PATH] [--server-name NAME]  # cleanup legacy MCP registration
  axis codex use [--runtime-url URL] [--client-command CMD] [--app-server-command CMD] [--ensure-runtime true|false] [--codex-home PATH]
  axis codex [--runtime-url URL] [--client-command CMD] [--app-server-command CMD] [--ensure-runtime true|false] [--codex-home PATH]

Options:
  --bind-host HOST    绑定地址 (默认: 127.0.0.1, 仅本机访问; 使用 0.0.0.0 允许局域网访问)
  --ui-dev            仅把 visualization 切到本机 next dev，页面改动会自动热更新
  --embedding-base-url URL   第三方 embedding 接口地址，也可通过 EMBEDDING_BASE_URL 提供
  --embedding-model MODEL    第三方 embedding 模型名，也可通过 EMBEDDING_MODEL 提供
  --embedding-api-key KEY    第三方 embedding 鉴权，可选，也可通过 EMBEDDING_API_KEY 提供
  --provider-kind KIND       mna 模型类型，支持 demo / openai-compatible / anthropic / ollama
  --provider-model MODEL     mna 模型名；仅对本次启动生效，页面默认读取已保存配置
  --provider-base-url URL    mna provider 地址；仅对本次启动生效
  --provider-api-key-env ENV mna provider 鉴权环境变量名；仅对本次启动生效
`;
}
