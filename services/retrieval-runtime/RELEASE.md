# retrieval-runtime 发布说明

`retrieval-runtime` 现在不再承担对外用户入口 npm 包的发布职责。

当前这层主要保留两类内容：

- 运行时服务本身
- 宿主适配与插件源产物

## 1. 这一层现在怎么用

在 `services/retrieval-runtime` 目录，主要执行这些动作：

```bash
npm install
npm run check
npm run build
npm test
```

这层仍然负责：

- `retrieval-runtime` HTTP 服务
- `memory-claude-plugin` 插件源目录
- `memory-codex-adapter` 宿主适配目录

## 2. 用户入口发布在哪里

用户安装、统一命令、页面启动、Claude 插件安装、Codex 启动编排，已经移到：

```text
packages/continuum-cli
```

也就是说：

- 面向用户的 npm 包：`@jiankarlin/continuum`
- 这一层：内部服务包与宿主适配源产物

## 3. Claude 插件打包在哪里做

Claude 插件 zip 的正式打包入口已经移到：

```text
packages/continuum-cli
```

如果只想查看插件源文件，仍然看这里：

```text
services/retrieval-runtime/host-adapters/memory-claude-plugin
```
