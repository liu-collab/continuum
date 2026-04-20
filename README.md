# Continuum

Continuum 是一个给 `Claude Code`、`Codex` 这类 agent 宿主接入长期上下文能力的产品。

它主要解决三件事：

- 把用户已经说过、之后还会反复用到的信息，整理成结构化记忆
- 在关键时刻主动恢复上下文，而不是等模型自己想起来再查
- 把记忆目录、运行轨迹和关键指标做成可查看、可排查的页面

这不是一个单纯“存聊天记录”的仓库。它更强调 `上下文连续性`，也就是让 agent 在跨轮次、跨任务、重启之后，仍然能接着之前的状态继续工作。

## 它能带来什么能力

接入 Continuum 之后，agent 侧重点会落在下面几类能力上：

- 记住用户偏好、长期事实、任务状态和关键事件
- 在会话开始、任务切换、规划前、回复前这些时刻主动恢复上下文
- 在本轮结束后，把值得沉淀的信息写回记忆系统
- 让使用者能看到当前有哪些记忆、这轮为什么触发、写回了什么、哪里降级了

如果直接说用户感受，重点一般是这几件事：

- 少重复解释
- 少丢上下文
- 多轮任务更连续
- 问题更容易排查

## 适合什么场景

Continuum 适合接到下面这类 agent 使用场景里：

- 长对话、多轮协作
- 有任务状态延续的编码助手
- 需要记住偏好、约束和工作方式的个人 agent
- 需要查看召回效果、写回结果和运行指标的产品化系统

## 仓库里有什么

这个仓库当前包含三块能力：

- `storage`
  负责结构化记忆写入、治理和共享读模型发布
- `retrieval-runtime`
  负责运行时检索、记忆注入和回合结束后的写回检查
- `visualization`
  负责把记忆目录、运行轨迹和关键指标展示出来

对用户来说，可以先这样理解：

- `storage` 负责把记忆存对
- `retrieval-runtime` 负责把记忆用对
- `visualization` 负责把结果看清楚

## 推荐交付方式

对最终用户来说，Continuum 更适合按两种形态交付：

- 用户入口发成 `npm package`（npm 安装包），用户安装后直接使用统一命令
- `Claude Code` 侧发成 `plugin`（插件）版本，用户按插件方式安装

这样用户看到的是两个清晰入口：

- 一个是安装后即可使用的统一 `CLI`
- 一个是可以直接挂到 `Claude Code` 上的插件

## 怎么接入 Claude Code

如果你要把 Continuum 接到 `Claude Code`，面向用户的使用方式是：

对最终用户来说，更合适的使用方式是：

### 1. 安装 `@jiankarlin/continuum`

```bash
npm install -g @jiankarlin/continuum
```

### 2. 安装 Continuum 的 Claude 插件版本

```bash
continuum claude install
```

用户安装的是已经打包好的 `Claude Code plugin`（Claude Code 插件），而不是手动去跑仓库里的桥接脚本。

### 3. 按插件方式启动 Claude Code

安装完成后，就按正常插件接入方式使用 `Claude Code`。

用户视角下，接入完成后会得到的效果是：

- 开始会话时可以恢复已有上下文
- 交互过程中能在关键时刻补充记忆
- 回合结束后能自动做写回检查

这里不需要用户手动一轮轮去调用记忆工具，正常使用 `Claude Code` 就可以。

## 怎么接入 Codex

如果你要把 Continuum 接到 `Codex`，更适合对外发成统一 `CLI` 安装包。

对最终用户来说，更合适的使用方式是：

### 1. 安装 `@jiankarlin/continuum`

用户安装的是已经发布好的统一 `CLI` 包，而不是手动进入仓库运行脚本。

```bash
npm install -g @jiankarlin/continuum
```

### 2. 直接启动接好 Continuum 的 Codex

安装完成后，用户直接使用这个包提供的启动命令即可，不需要再关心仓库里的适配器目录。

例如：

```bash
continuum codex
```

如果只想看状态、启动页面、安装 Claude 插件，也都用这一个命令：

```bash
continuum start
continuum stop
continuum status
continuum ui
continuum claude install
```

统一入口就是 `continuum`。

## 平台支持

**注意：`continuum start` 当前仅支持 Windows 平台**，依赖 `winget` 和 PowerShell 进行 Docker 安装和进程管理。

其他平台用户请：
- 手动运行各服务（storage、retrieval-runtime、visualization）
- 或使用 Docker Compose 自行编排

## 一键启动

如果希望在用户机器上直接拉起 Continuum 自己管理的一套本地依赖，可以直接执行：

```bash
continuum start
```

如果你是在这个源码仓库里直接开发，也可以在仓库根目录用 `npm` 启动：

```bash
npm run start
```

这条命令当前会做这些事情：

- 启动或拉起 Continuum 自己的单一 Docker 容器
- 容器内部统一运行 `PostgreSQL + pgvector`、`storage`、`storage worker`、`retrieval-runtime`、`visualization`
- 容器内部会自己安装并构建各个服务，不依赖用户机器上的本地构建产物
- 使用 Continuum 自己的固定容器名和独立端口，不占用用户现有数据库实例
- 所有服务端口绑定到 `127.0.0.1`，仅本机可访问，避免局域网暴露
- 容器启动时自动执行 `storage` 和 `retrieval-runtime` 的数据库迁移
- 向量能力直接连接用户提供的第三方 `OpenAI-compatible embeddings API`，不会在本地再起一个伪向量服务

默认约定：

- PostgreSQL 端口：`54329`（默认绑定 127.0.0.1）
- storage：`3001`（默认绑定 127.0.0.1）
- retrieval-runtime：`3002`（默认绑定 127.0.0.1）
- visualization：`3003`（默认绑定 127.0.0.1）

启动前需要提供第三方向量配置：

```bash
$env:EMBEDDING_BASE_URL="https://api.openai.com/v1"
$env:EMBEDDING_MODEL="text-embedding-3-small"
$env:EMBEDDING_API_KEY="your-key"
continuum start
```

也可以直接写在命令参数里：

```bash
continuum start --embedding-base-url https://api.openai.com/v1 --embedding-model text-embedding-3-small
```

如需局域网访问（如手机测试），可使用：

```bash
continuum start --bind-host 0.0.0.0
```

停止服务：

```bash
continuum stop
```

如果只是想打开页面：

```bash
continuum ui
```

这条命令会优先连接已经由 `continuum start` 拉起的可视化页面。

## 源码开发启动

如果你要在源码仓库里直接跑开发态，可以在仓库根目录执行：

```bash
npm run dev
```

这条命令会一起启动：

- `storage`
- `storage worker`
- `retrieval-runtime`
- `visualization`
- `memory-native-agent`

这条命令默认会先执行 `storage` 和 `retrieval-runtime` 的迁移，然后再进入热更新开发态。

当前约定如下：

- 本地数据库默认使用 `postgres://postgres:postgres@127.0.0.1:5432/agent_memory`
- `storage` 默认端口 `3001`
- `retrieval-runtime` 默认端口 `3002`
- `visualization` 默认端口 `3003`
- `memory-native-agent` 默认端口 `4193`

如果本地数据库已经自己准备好了，也可以直接覆盖环境变量后再执行 `npm run dev`。

用户视角下，它提供的效果也是：

- 开始使用时自动接入上下文恢复能力
- 关键时刻自动补充记忆
- 回合结束后自动做写回检查

## 这个仓库现在更适合怎么用

当前仓库更适合下面两类用途：

- 作为 Continuum 的主开发仓库，继续补全三层服务
- 作为对外发布 `@jiankarlin/continuum` 和 `Claude Code 插件` 的源码仓库

如果你是第一次看这个仓库，更建议把它理解成：

- 一个正在落地的产品仓库
- 而不是一篇架构设计说明

## 当前重点能力

这版最值得关注的重点，不是“我们做了几个服务”，而是下面三件事：

- 结构化记忆，不是原始聊天堆积
- 主动上下文恢复，不依赖模型临时起意
- 可观测性，能看到记忆、轨迹和指标

## 文档入口

如果要继续看详细文档，建议从这里开始：

1. `docs/current-phase-closure-plan.md`
2. `docs/product-baseline.md`
3. `docs/architecture-independence.md`
4. `docs/memory-module-contract.md`
5. `docs/README.md`

如果要看具体模块：

- `docs/retrieval`
- `docs/storage`
- `docs/visualization`
