# Axis

Persistent memory layer for AI coding agents — keeps preferences, task state, and context alive across sessions.

[![GitHub Repo stars](https://img.shields.io/github/stars/liu-collab/axis?style=social)](https://github.com/liu-collab/axis/stargazers)
[![npm version](https://img.shields.io/npm/v/axis-agent)](https://www.npmjs.com/package/axis-agent)
[![npm downloads](https://img.shields.io/npm/dm/axis-agent)](https://www.npmjs.com/package/axis-agent)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)

[中文文档](./README_CN.md)

## Vision

AI coding agents are powerful, but every session is a blank slate. Close the terminal and your preferences, conventions, and task progress are gone.

Axis pulls memory out of the model and into a dedicated system layer. The model doesn't have to remember everything — the system injects the right context at the right time.

The bigger picture: **a main model shouldn't work alone**. It should be surrounded by auxiliary models, each handling what it's best at — summarization, retrieval, injection timing, context pruning. The main model focuses on decisions and generation; the auxiliary layer ensures it always has clean, complete context.

Memory injection is the first auxiliary pipeline we've built. More will follow: automatic context pruning, multi-model collaboration, memory summarization and compression.

## What it does

- **Structured memory** — extracts durable facts, preferences, and task state from conversations instead of storing raw chat logs
- **Proactive recall** — injects relevant context at session start, before responses, and during task switches without waiting for the model to ask
- **Observability** — built-in dashboard shows what was remembered, what was recalled, and why

## Architecture

### Main model + auxiliary model collaboration

```mermaid
flowchart TB
    subgraph main["Main Model"]
        M["Claude Code / Codex / Custom Agent<br/>Decision & Generation"]
    end

    subgraph aux["Auxiliary Model Layer"]
        T["Tool Assistance<br/>file I/O, search, execution"]
        MEM["Memory Assistance<br/>summarization, retrieval, injection, writeback"]
        CTX["Context Assistance<br/>(planned)<br/>window pruning, priority ranking"]
    end

    subgraph runtime["Memory Runtime"]
        RT["retrieval-runtime<br/>trigger · recall · inject · writeback"]
        ST["storage<br/>write model · governance · read model projection"]
    end

    subgraph store["Storage & Observability"]
        DB[("PostgreSQL + pgvector")]
        VIZ["visualization<br/>dashboard · observability"]
    end

    M <-->|"tool calls"| T
    M <-->|"memory context"| MEM
    MEM --> RT --> ST --> DB
    RT --> VIZ
    ST --> VIZ
    CTX -.->|"coming"| M
```

Core principle: **the main model decides, auxiliary models handle context engineering**. Memory is the first pipeline. Tool optimization, context pruning, and multi-model collaboration will follow.

### Current services

| Service | Responsibility |
|---------|---------------|
| **storage** | Memory writes, structuring, conflict detection, governance, read model projection |
| **retrieval-runtime** | Trigger decisions, semantic search, memory injection, writeback coordination |
| **visualization** | Memory record browser, recall trace viewer, system metrics |

### Data flow

```mermaid
flowchart LR
    host["Host Agent<br/>Claude Code · Codex"]
    runtime["retrieval-runtime<br/>trigger · recall · inject · writeback"]
    storage["storage<br/>write · govern · read model"]
    db[("PostgreSQL + pgvector")]
    viz["visualization<br/>dashboard"]

    host -->|"prepare-context"| runtime
    runtime -->|"search / write"| storage
    storage --> db
    runtime --> viz
    storage --> viz
```

## Three-host A/B evaluation

We ran 100-task blind evaluations across three hosts (group A: no memory, group B: with memory):

| Metric | LLM (no tools·upper bound) | Claude Code | Codex |
|--------|:---:|:---:|:---:|
| B win rate | **0.75** | 0.64 | 0.57 |
| B task success | **4.49** | 3.38 | 4.13 |
| B memory usefulness | **2.81** | 2.02 | 1.95 |
| Tool event ratio B/A | — | 1.09 | 0.83 |

LLM has no tools — memory is the only source, used directly. That's the theoretical ceiling. Real hosts (Claude Code / Codex) have tools; the model verifies memory against the filesystem before trusting it. That friction burns attention and tokens. Full data and analysis in `services/retrieval-runtime/tests/e2e/real-user-experience/README.md`.

## Quick Start

### Install the CLI

```bash
npm install -g axis-agent
```

### Start all services

```bash
axis start \
  --embedding-base-url https://api.openai.com/v1 \
  --embedding-model text-embedding-3-small
```

Launches a single Docker container with PostgreSQL + pgvector, storage, retrieval-runtime, and visualization. All ports bind to `127.0.0.1`.

| Service | Default Port |
|---------|-------------|
| PostgreSQL | 54329 |
| storage | 3001 |
| retrieval-runtime | 3002 |
| visualization | 3003 |

### Connect hosts

```bash
axis claude install   # Claude Code
axis codex            # Codex
```

### Other commands

```bash
axis status    # check running services
axis ui        # open the dashboard
axis stop      # shut everything down
```

## Development

Requires Node.js >= 22 and a local PostgreSQL instance.

```bash
git clone https://github.com/anthropics/agent-memory.git
cd agent-memory
npm run dev
```

Starts all services in dev mode with hot reload. Default database: `postgres://postgres:postgres@127.0.0.1:5432/agent_memory`.

### Project structure

```
services/
  storage/              # memory persistence and governance
  retrieval-runtime/    # recall, injection, and writeback
  visualization/        # Next.js dashboard
  memory-native-agent/  # reference host adapter
packages/
  axis-cli/        # CLI tooling and distribution
```

### Running tests

```bash
cd services/retrieval-runtime && npx vitest run
cd services/storage && npx vitest run
```

## Roadmap

The core memory injection pipeline is in place. Next steps along the auxiliary model direction:

- **Automatic context pruning** — auxiliary model compresses context to fit the window before injection, removing duplicates and stale content
- **Multi-model collaboration** — summarization, retrieval, trigger decisions, and quality assessment each run on smaller, faster models independently
- **Writeback quality gating** — auxiliary model validates writeback candidates before storage to reduce noise
- **Memory dedup and merging** — similar memories auto-merge, expired ones auto-demote
- **Configurable auxiliary models** — different auxiliary tasks can target different models, no hard binding

The goal stays the same: the main model always has clean, complete context. No more amnesia.

## Platform Support

`axis start` currently supports **Windows** (requires Docker Desktop). Other platforms can run services manually or via Docker Compose.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=liu-collab/axis&type=Date)](https://star-history.com/#liu-collab/axis&Date)

## License

Licensed under the Apache License, Version 2.0. See `LICENSE`.
