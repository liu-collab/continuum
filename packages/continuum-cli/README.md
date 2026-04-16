# continuum-cli

`continuum-cli` 是 Continuum 的统一用户入口。

它负责四类用户命令：

- `continuum status`
- `continuum ui`
- `continuum claude install`
- `continuum codex`

这层只做交付、安装和启动编排，不承担三大服务的业务实现。
