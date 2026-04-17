# @jiankarlin/continuum

`@jiankarlin/continuum` 是 Continuum 的统一用户入口。

它负责四类用户命令：

- `continuum start`
- `continuum stop`
- `continuum status`
- `continuum ui`
- `continuum claude install`
- `continuum codex`

这层只做交付、安装和启动编排，不承担三大服务的业务实现。

## 平台支持

**当前 `continuum start` 仅支持 Windows 平台**，依赖 `winget` 和 PowerShell 进行 Docker 安装和进程管理。

其他平台用户请：
- 手动运行各服务（storage、retrieval-runtime、visualization）
- 或使用 Docker Compose 自行编排

## 命令说明

- `continuum start` 会拉起 Continuum 自己管理的单一 Docker 容器
- 容器内部统一运行 `PostgreSQL + pgvector`、embedding、`storage`、`storage worker`、`retrieval-runtime`、`visualization`
- 数据库使用 Continuum 自己的容器和默认端口 `54329`，不会直接占用用户已有 PostgreSQL 实例
- 默认绑定到 `127.0.0.1`（仅本机访问），可通过 `--bind-host 0.0.0.0` 允许局域网访问
- `continuum stop` 停止并移除 managed 容器，清理状态文件
- `continuum ui` 会优先连接已经通过 `continuum start` 启动好的页面；如果本地没有运行中的页面，才回退到包内自带的可视化产物

## 安全说明

默认情况下，所有服务端口绑定到 `127.0.0.1`，仅本机可访问。如果需要局域网内其他设备访问（如手机测试），可以使用：

```bash
continuum start --bind-host 0.0.0.0
```

**注意**：使用 `0.0.0.0` 会将服务暴露到局域网，请确保在可信网络环境下使用。

