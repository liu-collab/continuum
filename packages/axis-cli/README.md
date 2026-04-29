# axis-agent

Axis 的统一命令行入口。负责安装、启动编排和宿主接入，不承担后端服务的业务实现。

## 安装

```bash
npm install -g axis-agent
axis --help
```

## 快速开始

```bash
axis doctor   # 检查环境是否就绪（可选但推荐）
axis start    # 启动所有服务
axis ui       # 打开页面
```

首次启动会构建 Docker 镜像（约 3-8 分钟）。`embedding` 和 `memory_llm` 可在页面设置面板中后续配置，不影响启动和对话。

## 平台支持

| 平台 | 支持程度 |
|---|---|
| **Windows** | 完整支持，winget 自动安装 Docker + 全自动启动 |
| **macOS** | 支持，需自行安装 Docker Desktop，`axis start` 自动检测并启动 |
| **Linux** | 部分支持，需自行安装 Docker Engine 并手动配置 |

## 命令参考

| 命令 | 说明 |
|---|---|
| `axis start` | 启动完整托管栈：Docker 容器（PostgreSQL + storage + retrieval-runtime + visualization）+ MNA |
| `axis stop` | 停止并清理所有服务 |
| `axis status` | 查看服务健康状态 |
| `axis restart <runtime\|storage>` | 重启容器内指定服务 |
| `axis doctor` | 无副作用环境诊断（Node / Docker / 端口 / API Key） |
| `axis ui` | 打开或启动可视化页面 |
| `axis uninstall` | 清理 ~/.axis/、Docker 镜像及所有数据 |

### 宿主接入

| 命令 | 说明 |
|---|---|
| `axis claude` | 安装插件并启动 Claude Code（自动检测 `~/.axis/claude-plugin`） |
| `axis claude install` | 仅安装插件，不启动 |
| `axis codex` | 启动 Codex（平台强制注入模式，无需 MCP 工具调用） |
| `axis mna` | 单独管理 MNA：`install` / `start` / `stop` / `logs` / `token` |

### 常用参数

```bash
# 首次启动同时配置主模型
axis start \
  --provider-kind openai-compatible \
  --provider-model gpt-4.1-mini \
  --provider-base-url https://api.openai.com/v1 \
  --provider-api-key-env OPENAI_API_KEY

# 局域网访问
axis start --bind-host 0.0.0.0

# 启动后自动打开页面
axis start --open

# 后台运行
axis start --daemon
```

## 目录结构

```
~/.axis/
  state.json              # 托管状态（端口、容器名）
  logs/                   # 运行日志
  managed/
    config.json           # 统一配置（provider / embedding / memory_llm / governance）
    secrets.json          # 密钥
    mna/                  # MNA 运行数据
  claude-plugin/          # Claude Code 插件
```
