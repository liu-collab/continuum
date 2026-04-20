# @jiankarlin/continuum 发布说明

对外给用户安装的主包是：

- `@jiankarlin/continuum`

这个包负责：

- `continuum status`
- `continuum ui`
- `continuum claude install`
- `continuum codex`

## 1. 本地发布前检查

先在 `packages/continuum-cli` 目录执行：

```bash
npm install
npm run release:verify
```

这一步会完成：

- 准备 vendor 产物
- 准备 `continuum start` 所需的 Docker stack 源码上下文
- 检查类型
- 构建 CLI
- 跑测试

## 2. 发布 npm 包

```bash
npm publish --access public
```

发布完成后，用户入口就是：

```bash
npm install -g @jiankarlin/continuum
continuum status
continuum ui
continuum claude install
continuum codex
```

## 3. 打包 Claude 插件

```bash
npm run package:claude-plugin
```

产物输出到：

```text
packages/continuum-cli/dist/release/
```

文件名格式：

```text
continuum-claude-plugin-v<version>.zip
```

## 4. GitHub Actions

统一发布工作流：

```text
.github/workflows/release-continuum.yml
```

现在以 `@jiankarlin/continuum` 作为 npm 发布主入口。

### 自动发布 tag 规则

这条工作流会在推送下面格式的 tag 时自动发布：

```text
continuum-v<package.json 里的版本号>
```

最小发布步骤：

```bash
cd packages/continuum-cli
npm version patch
git push origin main
git tag continuum-v0.2.4
git push origin continuum-v0.2.4
```

工作流会先校验 tag 和 `package.json` 版本一致，再执行发布。
