# Axis

持续记忆层，为 AI coding agent 提供跨会话的偏好记忆、任务状态追踪和上下文延续能力。

[![GitHub Repo stars](https://img.shields.io/github/stars/liu-collab/axis?style=social)](https://github.com/liu-collab/axis/stargazers)
[![npm version](https://img.shields.io/npm/v/axis-agent)](https://www.npmjs.com/package/axis-agent)
[![npm downloads](https://img.shields.io/npm/dm/axis-agent)](https://www.npmjs.com/package/axis-agent)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)

[English](./README.md)

## 思路

现在 AI coding agent 的能力越来越强，但有一个根本问题没解决：每一轮对话都是孤立的。模型关掉再打开，之前的偏好、约定、任务进度全丢了。

Axis 的思路是把"记忆"从模型身上拆出来，做成一个独立运行的系统层。不是让模型自己记住一切，而是让模型在需要的时候，由系统把对的东西塞回给它。

更进一步的想法是：主模型不应该是单打独斗的。它身边应该有一圈辅助模型，各自做各自擅长的事——有的负责摘要、有的负责检索、有的负责判断什么时候该注入、有的负责在注入前把上下文修剪到刚好能塞进窗口的大小。主模型只做决策和生成，辅助模型负责让主模型永远有完整、干净的上下文可用。

当前阶段先从记忆注入开始做起。后续可以沿着这个方向继续加：上下文自动修剪、多辅助模型协作、memory 摘要与压缩，等等。

## 现在能做什么

- **结构化记忆** — 从对话里提取偏好、规则、任务状态，而不是存原始聊天记录
- **主动召回** — 在会话开始、回答前、任务切换时自动注入相关上下文，不等模型自己来要
- **可观测** — 内置 dashboard 能看到什么被记住了、什么被召回了、为什么

## 架构

### 主模型 + 辅助模型协作

```mermaid
flowchart TB
    subgraph main["主模型"]
        M["Claude Code / Codex / 自定义 Agent<br/>决策与生成"]
    end

    subgraph aux["辅助模型层"]
        T["工具调用辅助<br/>文件读写、搜索、执行"]
        MEM["记忆辅助<br/>摘要、检索、注入、写回"]
        CTX["上下文辅助<br/>（规划中）<br/>窗口修剪、优先级排序"]
    end

    subgraph runtime["记忆运行时"]
        RT["retrieval-runtime<br/>触发判断 · 语义检索 · 注入 · 写回"]
        ST["storage<br/>写入模型 · 冲突检测 · 治理 · 读模型投影"]
    end

    subgraph store["存储与观测"]
        DB[("PostgreSQL + pgvector")]
        VIZ["visualization<br/>dashboard · 运行观测"]
    end

    M <-->|"工具调用"| T
    M <-->|"记忆上下文"| MEM
    MEM --> RT --> ST --> DB
    RT --> VIZ
    ST --> VIZ
    CTX -.->|"后续"| M
```

核心理念：主模型只做决策，辅助模型负责上下文工程。记忆是第一条辅助管线，后续工具调用优化、上下文修剪、多辅助模型协作会陆续补上。

### 当前服务边界

| 服务 | 负责 |
|------|------|
| **storage** | 记忆写入、结构化、冲突检测、治理规则、读模型投影 |
| **retrieval-runtime** | 触发决策、语义检索、记忆注入、写回协调 |
| **visualization** | 记忆记录浏览、召回轨迹查看、系统运行指标 |

### 数据流

```mermaid
flowchart LR
    host["宿主 Agent<br/>Claude Code · Codex"]
    runtime["retrieval-runtime<br/>触发 · 召回 · 注入 · 写回"]
    storage["storage<br/>写入 · 治理 · 读模型"]
    db[("PostgreSQL + pgvector")]
    viz["visualization<br/>dashboard"]

    host -->|"prepare-context"| runtime
    runtime -->|"检索 / 写入"| storage
    storage --> db
    runtime --> viz
    storage --> viz
```

## 三宿主 A/B 评测

我们在三种宿主上跑了 100 个任务的盲评对比（A 组无记忆，B 组有记忆）：

| 指标 | LLM（无工具·上限） | Claude Code | Codex |
|------|:---:|:---:|:---:|
| B 组胜率 | **0.75** | 0.64 | 0.57 |
| B 组任务完成度 | **4.49** | 3.38 | 4.13 |
| B 组记忆有用性 | **2.81** | 2.02 | 1.95 |
| 工具调用 B/A 比 | — | 1.09 | 0.83 |

LLM 组没有工具调用，记忆是唯一信源，模型拿到直接用——这是理论上限。真实宿主（Claude Code / Codex）有工具，模型拿到记忆后会先探索文件系统去验证，这个"自己确认一遍"的行为消耗了注意力和 token，记忆有用性就打折了。详细数据和分析见 `services/retrieval-runtime/tests/e2e/real-user-experience/README.md`。

## 快速开始

### 安装 CLI

```bash
npm install -g axis-agent
```

### 启动全部服务

```bash
axis start \
  --embedding-base-url https://api.openai.com/v1 \
  --embedding-model text-embedding-3-small
```

这会启动一个包含 PostgreSQL + pgvector、storage、retrieval-runtime、visualization 的 Docker 容器。所有端口绑定到 `127.0.0.1`。

| 服务 | 默认端口 |
|------|---------|
| PostgreSQL | 54329 |
| storage | 3001 |
| retrieval-runtime | 3002 |
| visualization | 3003 |

### 接入宿主

```bash
axis claude install   # Claude Code
axis codex            # Codex
```

### 其他命令

```bash
axis status    # 查看运行状态
axis ui        # 打开 dashboard
axis stop      # 停止全部服务
```

## 开发

需要 Node.js >= 22 和本地 PostgreSQL。

```bash
git clone https://github.com/liu-collab/axis.git
cd axis
npm run dev
```

开发模式下全部服务热重载。默认数据库：`postgres://postgres:postgres@127.0.0.1:5432/agent_memory`。

### 项目结构

```
services/
  storage/              # 记忆持久化与治理
  retrieval-runtime/    # 召回、注入、写回
  visualization/        # Next.js dashboard
  memory-native-agent/  # 参考宿主适配器
packages/
  axis-cli/        # CLI 工具与分发
```

### 跑测试

```bash
cd services/retrieval-runtime && npx vitest run
cd services/storage && npx vitest run
```

## 后续计划

当前阶段完成了最核心的记忆注入管线。后续会沿着"辅助模型层"这个方向继续做：

- **上下文自动修剪** — 辅助模型在注入前把上下文压缩到窗口大小，去掉重复和已失效内容
- **多辅助模型协作** — 摘要、检索、触发判断、质量评估各自用更小更快的模型独立跑
- **写回质量闭环** — 写回前由辅助模型做质量校验，减少噪声写入
- **记忆去重与合并** — 相似记忆自动合并，过期记忆自动降级
- **配置化辅助模型** — 不同辅助任务可以指定不同模型，不绑死一套配置

目标一直没变：主模型永远有干净、完整的上下文可用，不再"失忆"。

## 平台支持

`axis start` 当前支持 **Windows**（需要 Docker Desktop）。其他平台可以手动启动服务或通过 Docker Compose。

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=liu-collab/axis&type=Date)](https://star-history.com/#liu-collab/axis&Date)

## License

Licensed under the Apache License, Version 2.0. See `LICENSE`.
