export function renderHelp() {
  return `Continuum CLI

Commands:
  continuum start [--open] [--postgres-port PORT] [--bind-host HOST] [--embedding-base-url URL] [--embedding-model MODEL] [--embedding-api-key KEY]
  continuum stop
  continuum status [--json] [--strict] [--runtime-url URL] [--storage-url URL] [--ui-url URL] [--database-url URL] [--timeout MS]
  continuum ui [--host HOST] [--port PORT] [--open] [--url URL] [--runtime-url URL] [--storage-url URL] [--database-url URL]
  continuum claude install [--plugin-dir PATH] [--package PKG] [--force]
  continuum codex [--runtime-url URL] [--client-command CMD] [--app-server-command CMD] [--ensure-runtime true|false]

Options:
  --bind-host HOST    绑定地址 (默认: 127.0.0.1, 仅本机访问; 使用 0.0.0.0 允许局域网访问)
  --embedding-base-url URL   第三方 embedding 接口地址，也可通过 EMBEDDING_BASE_URL 提供
  --embedding-model MODEL    第三方 embedding 模型名，也可通过 EMBEDDING_MODEL 提供
  --embedding-api-key KEY    第三方 embedding 鉴权，可选，也可通过 EMBEDDING_API_KEY 提供
`;
}
