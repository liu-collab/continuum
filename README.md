# Continuum

Persistent memory layer for AI coding agents. Gives Claude Code, Codex, and custom agents the ability to remember preferences, track task state, and carry context across sessions.

[![GitHub Repo stars](https://img.shields.io/github/stars/liu-collab/continuum?style=social)](https://github.com/liu-collab/continuum/stargazers)

## What it does

- **Structured memory** — extracts durable facts, preferences, and task state from conversations instead of storing raw chat logs
- **Proactive recall** — injects relevant context at session start, before responses, and during task switches without waiting for the model to ask
- **Observability** — surfaces what was remembered, what was recalled, and why through a built-in dashboard

## Architecture

```
┌────────────────────────────────────────────────────┐
│                   Host Adapters                    │
│          Claude Code · Codex · Custom Agent        │
└──────────────┬────────────────────┬────────────────┘
               │  prepare-context   │  finalize-turn
               ▼                    ▼
┌──────────────────────────────────────────────────┐
│              retrieval-runtime                    │
│   trigger → query → inject → writeback            │
└──────────────┬────────────────────┬───────────────┘
               │  read model        │  write-back
               ▼                    ▼
┌──────────────────────────────────────────────────┐
│                   storage                         │
│   PostgreSQL + pgvector · conflict · governance   │
└──────────────────────────────────────────────────┘
```

| Service | Role |
|---|---|
| **storage** | Write model, conflict detection, governance, read model projection |
| **retrieval-runtime** | Trigger decisions, semantic search, memory injection, writeback coordination |
| **visualization** | Dashboard for memory records, recall traces, and system metrics |

## Quick Start

### Install the CLI

```bash
npm install -g @jiankarlin/continuum
```

### Start all services

```bash
continuum start \
  --embedding-base-url https://api.openai.com/v1 \
  --embedding-model text-embedding-3-small
```

This launches a single Docker container running PostgreSQL + pgvector, storage, retrieval-runtime, and visualization. All ports bind to `127.0.0.1`.

| Service | Default Port |
|---|---|
| PostgreSQL | 54329 |
| storage | 3001 |
| retrieval-runtime | 3002 |
| visualization | 3003 |

### Connect to Claude Code

```bash
continuum claude install
```

### Connect to Codex

```bash
continuum codex
```

### Other commands

```bash
continuum status    # check running services
continuum ui        # open the dashboard
continuum stop      # shut everything down
```

## Development

Requires Node.js >= 22 and a local PostgreSQL instance.

```bash
git clone https://github.com/anthropics/agent-memory.git
cd agent-memory
npm run dev
```

This starts all services in development mode with hot reload. Default database: `postgres://postgres:postgres@127.0.0.1:5432/agent_memory`.

### Project structure

```
services/
  storage/              # memory persistence and governance
  retrieval-runtime/    # recall, injection, and writeback
  visualization/        # Next.js dashboard
  memory-native-agent/  # reference host adapter
packages/
  continuum-cli/        # CLI tooling and distribution
```

### Running tests

```bash
cd services/retrieval-runtime && npx vitest run
cd services/storage && npx vitest run
```

## Platform Support

`continuum start` currently supports **Windows** only (requires Docker Desktop). Other platforms can run services manually or via Docker Compose.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=liu-collab/continuum&type=Date)](https://star-history.com/#liu-collab/continuum&Date)

## License

Licensed under the Apache License, Version 2.0. See `LICENSE`.
