export function renderHelp() {
  return `Continuum CLI

Commands:
  continuum status [--json] [--strict] [--runtime-url URL] [--storage-url URL] [--ui-url URL] [--database-url URL] [--timeout MS]
  continuum ui [--host HOST] [--port PORT] [--open] [--url URL] [--runtime-url URL] [--storage-url URL] [--database-url URL]
  continuum claude install [--plugin-dir PATH] [--package PKG] [--force]
  continuum codex [--runtime-url URL] [--client-command CMD] [--app-server-command CMD] [--ensure-runtime true|false]
`;
}
