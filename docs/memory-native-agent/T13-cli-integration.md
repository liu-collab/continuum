# T13 — continuum-cli 集成 mna 启停

## 1. 目标

把 `memory-native-agent` 纳入 `@jiankarlin/continuum` 统一交付链路，让用户用现有 `continuum start` / `continuum status` 就能一起管 mna，而不是额外手动拉一个 Node 进程。

这是产品侧决策：**用户体验上 mna 应该和 runtime/storage/visualization 一样被 continuum 统一编排**。

## 2. 前置依赖

- T01 mna 骨架完成（可执行的 HTTP server）
- T12 端口约定落实

## 3. 交付物

### 3.1 修改文件

```
packages/continuum-cli/
├── src/
│   ├── start-command.ts         # 追加 mna 启动步骤
│   ├── status-command.ts        # 追加 mna 健康检查
│   ├── stop-command.ts          # 追加 mna 停止步骤
│   ├── managed-state.ts         # 记录 mna PID / 端口 / token 路径
│   └── mna-command.ts           # 新增：continuum mna install/start/stop 单独子命令
├── templates/
│   └── docker/
│       └── compose.yaml         # 若 mna 走 Docker，追加 service；否则只做 host-process
└── scripts/
    └── prepare-vendor.mjs       # 打包 mna 产物到 vendor/（参考 visualization）
```

### 3.2 启动模式选择

继承 continuum 现状，先走 **host process** 方式（不进 Docker），理由：

- mna 要访问用户本地文件系统（fs_read/fs_write），Docker 化要挂载 cwd 且权限模型复杂
- mna 要起子进程（MCP stdio、shell_exec），容器内跨进程交互坑多
- 首版 `single_local_user` 场景 mna 就应该是用户空间进程

后续若用户强烈需要 Docker 化，再评估。首版明确只有 host 模式。

### 3.3 `continuum start` 扩展

现有启动顺序（依赖 Docker 起 pg/redis/storage/runtime，再用 host 启 visualization）之后追加：

```
4. 检查 ~/.mna/token.txt，不存在则先起 mna 让它自己生成
5. spawn node <vendor>/memory-native-agent/bin/mna-server.mjs
   - env: MNA_PORT=4193, RUNTIME_BASE_URL=http://127.0.0.1:4100
   - 用 detach + stdio 重定向到 ~/.continuum/logs/mna.log
6. 轮询 GET http://127.0.0.1:4193/healthz（最多 10s），等 ok
7. 把 pid 写入 ~/.continuum/managed/mna.json
```

### 3.4 `continuum status` 扩展

除了现有 storage/runtime/visualization 检查，补一列 mna：

```
[mna]   http://127.0.0.1:4193    healthy (v0.1.0)
        runtime dep:              reachable
        token path:               ~/.mna/token.txt
        artifacts:                ~/.mna/artifacts (3 sessions, 1.2 MB)
```

### 3.5 `continuum stop` 扩展

按启动逆序 kill mna → visualization → runtime → storage → docker down。
mna 使用 `SIGINT`，超时（3s）降级 `SIGKILL`。

### 3.6 `continuum mna` 子命令

单独操作入口，不依赖完整 start：

- `continuum mna install` — 安装/更新 vendor 里的 mna 产物
- `continuum mna start` — 仅启动 mna（前提：runtime 已在跑）
- `continuum mna stop`
- `continuum mna logs [--tail N]`
- `continuum mna token --print` — 显示当前 token（调试用）
- `continuum mna token --rotate` — 删除并重建 token（会踢掉 visualization 前端连接）

### 3.7 vendor 打包

参考现有 `scripts/prepare-vendor.mjs` 对 visualization 的处理方式：

- 开发时：`prepare-vendor` 从 sibling `services/memory-native-agent/` 拷贝 `dist/` + `bin/` + `package.json` 到 `packages/continuum-cli/vendor/memory-native-agent/`
- 发布时：`continuum` 包里已经带好 vendor，用户 `npm i -g @jiankarlin/continuum` 无需额外装 mna

### 3.8 版本矩阵

`continuum status --json` 输出里补 `mna.version`，并在 `RELEASE.md` 对照四个组件版本号：

```
continuum 0.2.0
├── storage 0.1.2
├── retrieval-runtime 0.1.3
├── visualization 0.1.1
└── memory-native-agent 0.1.0
```

## 4. 实施步骤

1. 在 `packages/continuum-cli/src/` 读既有 `start-command.ts` 理解编排流程（管 pid/端口/等待就绪的模式）。
2. 抄 visualization 启动代码的形状，做 mna 版本。
3. 加 `mna-command.ts` 实现 5 条子命令。
4. 改 `prepare-vendor.mjs` 加 mna 分支。
5. 改 `status-command.ts` 加一列显示。
6. 改 `stop-command.ts` 加反向 kill。
7. 加测试：`packages/continuum-cli/tests/mna-integration.test.ts`，用 stub mna 二进制验证启动-轮询-停止链路。

## 5. 验收标准

- `continuum start` 一次命令起全套（docker + runtime + visualization + mna），`continuum status` 全绿。
- `continuum stop` 干净退出，无残留进程、无端口占用。
- `continuum mna token --rotate` 生效，浏览器刷新 `/agent` 后自动拉新 token 恢复工作。
- `continuum start` 时 mna 端口已被占用 → 明确错误提示，整个 start 流程失败，不留半启动状态。
- 卸载 `@jiankarlin/continuum` 后 `~/.mna/token.txt` 与 `~/.mna/artifacts/` 保留（属于用户数据，不清理）。

## 6. 相关契约

- `docs/delivery-cli.md` —— continuum 定位与边界
- `docs/memory-native-agent/T12-cross-cutting.md` 第 2、7 节：token 与端口
- `packages/continuum-cli/src/start-command.ts` 现有实现

## 7. 文档回写要求

完成后同步：

- `docs/delivery-cli.md`：在"当前职责边界"一段的 `@jiankarlin/continuum 负责` 里加一条："管理 memory-native-agent 本地进程（安装、启动、停止、token 操作）"
- `packages/continuum-cli/README.md`：新增 `continuum mna` 子命令帮助

## 8. 不在范围内

- Docker 化的 mna
- 远程 mna（非 127.0.0.1）
- mna 的多实例（一台机器多个 mna 进程）
- 自动升级 / 版本漂移检测（后续独立任务）
