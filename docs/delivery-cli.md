# 交付层说明

这一层不是第四个业务服务，而是独立的交付与用户入口模块。

当前名称：

- `packages/continuum-cli`

它主要负责四类事情：

- `continuum start`
- `continuum status`
- `continuum ui`
- `continuum claude install`
- `continuum codex`

## 为什么要单独拆出来

这几个命令都不是单个服务内部命令，而是跨模块编排命令。

比如：

- `start` 要统一拉起本地 Docker 里的整套依赖和服务
- `status` 要同时看 `storage`、`retrieval-runtime`、`visualization`、数据库
- `ui` 要优先连接已经运行中的可视化页面，必要时再启动包内产物
- `claude install` 要安装宿主插件
- `codex` 要编排 `runtime + mcp + codex`

如果继续把这些命令放在某一个服务包里，就会产生两个问题：

- 用户入口和业务服务边界混在一起
- 三个服务被交付逻辑反向耦合

所以这里固定约定：

- 三个业务模块继续保持独立
- 用户命令统一收进 `@jiankarlin/continuum`

## 和三大模块的关系

这一层与三大模块的关系是：

- 只做启动、安装、探测、编排
- 不承接业务规则
- 不成为共享业务库
- 不让三大模块直接依赖它

因此它是一个独立模块，但不是第四个业务域。

## 当前职责边界

### `@jiankarlin/continuum` 负责

- 提供统一用户命令
- 统一拉起 Docker 本地运行环境
- 打包 `visualization` 的可启动产物
- 带上 `retrieval-runtime` 的宿主适配产物
- 安装 Claude 插件
- 启动接好 Continuum 的 Codex
- 做健康检查和数据库探测
- 在当前首版默认模式下传入工作区标识和默认 `memory_mode`

### `@jiankarlin/continuum` 不负责

- 改写 `storage` 的业务逻辑
- 改写 `retrieval-runtime` 的触发、检索、写回逻辑
- 改写 `visualization` 的页面逻辑
- 代替业务服务决定授权规则本身

## 当前首版补充

当前阶段交付层再补下面几条正式边界：

- 默认运行模式是 `single_local_user`
- 交付层负责给宿主和服务传入当前工作区标识
- 交付层负责设置默认 `memory_mode`
- `workspace` 级记忆是当前正式能力，不再视为默认关闭

## 一句话约定

Continuum 仍然是三个独立业务服务。

另外再加一个独立交付层，用来承接统一 CLI 和安装发布入口。
