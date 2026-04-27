# retrieval-runtime 发布说明

`retrieval-runtime` 不再负责对外用户入口 npm 包发布，这里主要维护：

- 运行时服务本身
- 宿主适配与插件源产物

## 1. 发布前检查清单

每次发布前，都从 `services/retrieval-runtime` 执行检查。

这版先固定一个原则：**依赖安装完成后，第一条校验命令固定是 `npm run check`，没过就停止发布检查。**  
也就是说，类型检查现在不是“建议项”，而是发布闸门。只有类型检查通过后，才继续构建、测试和后续发布动作。

### 1.1 固定必跑

- [ ] 确认当前目录是 `services/retrieval-runtime`
- [ ] 确认本地 `Node.js`（Node.js 运行时）版本不低于 `22`
- [ ] 先看本次改动范围：`git status --short`
- [ ] 安装依赖：默认使用 `npm ci`；只有需要按当前 `package.json` 重新解析依赖时，才改用 `npm install`
- [ ] 类型检查：`npm run check`
- [ ] 只有 `npm run check` 通过后，才继续后面的构建和测试
- [ ] 构建产物：`npm run build`
- [ ] 基础测试：`npm test`

### 1.2 按改动范围补跑

- [ ] 涉及宿主适配、插件源目录、`bin/`（命令入口目录）或端到端链路时，补跑 `npm run test:e2e`
- [ ] 涉及导入校验时，补跑 `npm run test:importer`
- [ ] 涉及记忆编排器真实评测时，补跑 `npm run test:memory-orchestrator-eval`
- [ ] 涉及真实用户体验评测时，补跑 `npm run test:real-user-experience`
- [ ] 涉及离线评测脚本、真实模型、写回质量或宿主 A/B 对比时，补跑对应的 `eval:*`（评测脚本）命令
- [ ] 涉及数据库迁移时，确认迁移文件、迁移说明和回滚口径已经同步
- [ ] 涉及配置、环境变量或发布文件列表时，确认 `.env.example`、`README.md`、`RELEASE.md` 和相关说明已经同步

### 1.3 提交或发布前再确认

- [ ] `.env`、本地日志、临时评测产物和密钥没有进入提交
- [ ] 如果改了依赖或脚本，确认 `package.json` 和 `package-lock.json` 已经同步
- [ ] 如果改了 `bin/`、`host-adapters/`、`migrations/`、`scripts/` 或文档清单，确认发布产物范围和 `files`（发布文件列表）口径一致
- [ ] 如果 `npm run check`、`npm run build`、`npm test` 任一失败，这次发布检查直接视为未通过
- [ ] 只暂存本次发布需要的文件，不使用 `git add .`

## 2. 最短执行顺序

```bash
git status --short
npm ci
npm run check
npm run build
npm test
```

现在固定按这个顺序看。关键点很明确：`npm run check` 没过，这次发布检查就停在这里，不继续 `build`、`test` 和后续发布动作。

## 3. 常用补跑命令

```bash
npm run test:e2e
npm run test:importer
npm run test:memory-orchestrator-eval
npm run test:real-user-experience
```

如果本次改动带了真实评测脚本或宿主 A/B 验证，再补跑对应的 `eval:*`（评测脚本）命令。

## 4. 这层现在负责什么

当前仍然负责：

- `retrieval-runtime` HTTP 服务
- `memory-claude-plugin` 插件源目录
- `memory-codex-adapter` 宿主适配目录

## 5. 用户入口发布在哪里

用户安装、统一命令、页面启动、Claude 插件安装、Codex 启动编排，已经移到：

```text
packages/continuum-cli
```

也就是说：

- 面向用户的 npm 包：`@jiankarlin/continuum`
- 这一层：内部服务和宿主适配源产物

## 6. Claude 插件打包在哪里做

Claude 插件 zip 的正式打包入口已经移到：

```text
packages/continuum-cli
```

如果只是查看插件源文件，仍然看这里：

```text
services/retrieval-runtime/host-adapters/memory-claude-plugin
```
