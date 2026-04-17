# @jiankarlin/continuum

`@jiankarlin/continuum` 是 Continuum 的统一用户入口。

它负责四类用户命令：

- `continuum start`
- `continuum status`
- `continuum ui`
- `continuum claude install`
- `continuum codex`

这层只做交付、安装和启动编排，不承担三大服务的业务实现。

其中：

- `continuum start` 会拉起 Continuum 自己管理的单一 Docker 容器
- 容器内部统一运行 `PostgreSQL + pgvector`、embedding、`storage`、`storage worker`、`retrieval-runtime`、`visualization`
- 数据库使用 Continuum 自己的容器和默认端口 `54329`，不会直接占用用户已有 PostgreSQL 实例
- `continuum ui` 会优先连接已经通过 `continuum start` 启动好的页面；如果本地没有运行中的页面，才回退到包内自带的可视化产物
