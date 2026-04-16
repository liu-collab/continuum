# 宿主接入正式交付物

这里放 `retrieval-runtime` 的正式宿主接入产物。

当前目录包含：

- `memory-claude-plugin`
- `memory-codex-adapter`

这两套产物只负责宿主生命周期接线、桥接和启动编排，不包含运行时主链路实现。

运行时主链路仍然在 `src/` 下，由 `retrieval-runtime` HTTP 服务统一承接。
