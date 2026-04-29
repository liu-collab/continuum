# axis-agent

`axis-agent` 是 Axis 的统一用户入口。

它负责四类用户命令：

- `axis start`
- `axis stop`
- `axis status`
- `axis ui`
- `axis claude install`
- `axis codex`
- `axis mna`

这层只做交付、安装和启动编排，不承担三大服务的业务实现。

## 平台支持

| 平台 | 支持程度 |
|---|---|
| **Windows** | 完整支持，winget 自动安装 Docker + 全自动启动 |
| **macOS** | 支持，需自行安装 Docker Desktop，`axis start` 自动检测并启动 |
| **Linux** | 部分支持，需自行安装 Docker Engine 并手动配置 |

macOS / Linux 环境变量设置示例：
```bash
export EMBEDDING_BASE_URL="https://api.openai.com/v1"
export EMBEDDING_MODEL="text-embedding-3-small"
export EMBEDDING_API_KEY="your-key"
axis start
```

## 命令说明

- `axis start` 会拉起 Axis 自己管理的单一 Docker 容器
- 容器内部统一运行 `PostgreSQL + pgvector`、`storage`、`storage worker`、`retrieval-runtime`、`visualization`
- 数据库使用 Axis 自己的容器和默认端口 `54329`，不会直接占用用户已有 PostgreSQL 实例
- 向量检索直接连接用户提供的第三方 `OpenAI-compatible embeddings API`
- 默认绑定到 `127.0.0.1`（仅本机访问），可通过 `--bind-host 0.0.0.0` 允许局域网访问
- `axis stop` 停止并移除 managed 容器，清理状态文件
- `axis start` 会在 stack 就绪后再启动 `memory-native-agent`
- `axis mna` 用来单独安装、启动、停止、查看日志和读取 token
- `axis ui` 会优先连接已经通过 `axis start` 启动好的页面；如果本地没有运行中的页面，才回退到包内自带的可视化产物
- `axis codex` 走平台强制注入：平台在 Codex 每轮开始前准备记忆上下文并通过 proxy 交付，不要求 Codex 主动调用 MCP 工具

## 安装

推荐直接全局安装：

```bash
npm install -g axis-agent
```

安装后可以先确认命令可用：

```bash
axis --help
```

## 第三方向量配置

`axis start` 可以先把托管栈启动起来，不要求你在启动前一定先写好 `embedding` 配置。

如果还没有提供下面这些配置：

- `EMBEDDING_BASE_URL`
- `EMBEDDING_MODEL`

页面仍然可以打开，但向量召回、相关依赖状态和健康检查会显示未配置或未就绪。

如果服务端需要鉴权，再补：

- `EMBEDDING_API_KEY`

建议在需要完整召回链路时补上。示例：

```bash
$env:EMBEDDING_BASE_URL="https://api.openai.com/v1"
$env:EMBEDDING_MODEL="text-embedding-3-small"
$env:EMBEDDING_API_KEY="your-key"
axis start
```

也可以通过参数直接传入：

```bash
axis start --embedding-base-url https://api.openai.com/v1 --embedding-model text-embedding-3-small
```

## 安全说明

默认情况下，所有服务端口绑定到 `127.0.0.1`，仅本机可访问。如果需要局域网内其他设备访问（如手机测试），可以使用：

```bash
axis start --bind-host 0.0.0.0
```

**注意**：使用 `0.0.0.0` 会将服务暴露到局域网，请确保在可信网络环境下使用。

## `axis mna`

可直接单独操作 `memory-native-agent`：

```bash
axis mna install
axis mna start
axis mna stop
axis mna logs
axis mna token
```

默认地址是 `http://127.0.0.1:4193`，默认数据目录是 `~/.axis/managed/mna`。
