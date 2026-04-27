# 本地宿主实机 E2E 验收

这里补的是"真实宿主链路"验证，不是仓库内的内存 stub 集成测试。

## 验证分两层

### 第一层：桥接链路验证（半自动）

- 直接调用真实桥接脚本：`memory-bridge.mjs`、`memory-codex-proxy.mjs`、`memory-mcp-server.mjs`
- 连接真实 `retrieval-runtime` HTTP 服务
- 不依赖 fake HTTP，不走内存注入替身
- 适合本地重复执行，也适合作为验收前检查

### 第二层：真实宿主对话注入验收（主验收）

- 由本机已安装的 `Claude Code` 或 `Codex` 客户端真实发起对话
- Claude 通过真实 hook 触发 retrieval-runtime 检索与注入
- Codex 由平台先调用 `prepare-context`，再把准备好的上下文强制交付给 Codex 输入
- 核心判定：Claude 看 runtime 轨迹 + 最终回答；Codex 看平台侧 `memory_delivery` + runtime 轨迹
- 同时通过 `observe/runs` 接口确认 runtime 侧确实发生了检索/注入轨迹

任何环节都不使用模拟，验证的是真实用户使用宿主时的完整注入链路。

## 前置条件

- Node.js 22+
- 已安装并能启动 `retrieval-runtime`
- 已安装可用的 `Claude Code` 客户端（如果要验 Claude）
- 已安装可用的 `Codex` 客户端（如果要验 Codex）
- runtime 默认地址：`http://127.0.0.1:3002`

## 配置模板

- `tests/e2e/fixtures/claude.local.env.example`
- `tests/e2e/fixtures/codex.local.env.example`

建议复制为本地文件使用，不要提交：

```
tests/e2e/fixtures/claude.local.env
tests/e2e/fixtures/codex.local.env
```

## 推荐执行顺序

1. 启动 `retrieval-runtime`（默认端口 3002）
2. 运行统一检查入口，确认依赖和 runtime 可达
3. 运行 Claude 或 Codex 真实宿主验收脚本

---

## Claude Code 验收

### 环境变量

至少需要：

- `MEMORY_RUNTIME_BASE_URL`（runtime 地址，默认 `http://127.0.0.1:3002`）
- `MEMORY_WORKSPACE_ID`
- `MEMORY_USER_ID`

### 桥接链路验证（第一层）

```bash
cd services/retrieval-runtime
npm run test:e2e -- tests/e2e/claude-local-host.e2e.test.ts
```

验收重点：

- `memory-bridge.mjs` 是否成功向 runtime 发出三阶段请求
- runtime 是否返回 `trace_id`
- `prepare-context` 是否返回 `additionalContext`

### 真实宿主对话注入验收（第二层）

```bash
cd services/retrieval-runtime
MEMORY_RUNTIME_BASE_URL=http://127.0.0.1:3002 \
node tests/e2e/real-claude-client.e2e.mjs
```

脚本会：

1. 检查 Claude CLI 可用性与 runtime 可达性
2. 创建临时工作区，写入 hook 配置（指向真实 `memory-bridge.mjs`）
3. 发起真实 Claude 会话（`claude -p <prompt> --output-format stream-json`）
4. 解析 Claude 输出，提取最终回答
5. 查询 `observe/runs`，确认 session 对应的注入轨迹
6. 断言最终回答命中 >= 2 个注入记忆关键词

---

## Codex 验收

### 环境变量

至少需要：

- `MEMORY_RUNTIME_BASE_URL`
- `MEMORY_WORKSPACE_ID`
- `MEMORY_USER_ID`

### 桥接链路验证（第一层）

```bash
cd services/retrieval-runtime
npm run test:e2e -- tests/e2e/codex-local-host.e2e.test.ts
```

验收重点：

- `memory-codex-proxy.mjs` 能启动
- proxy 能接受 WebSocket 连接
- proxy 能在 `turn/start` 前调用 `prepare-context`，并通过 `thread/inject_items` 强制交付上下文
- `memory-mcp-server.mjs` 仅作为调试入口保留，不是 Codex 主链路

### 真实宿主对话注入验收（第二层）

```bash
cd services/retrieval-runtime
MEMORY_RUNTIME_BASE_URL=http://127.0.0.1:3002 \
node tests/e2e/real-codex-client.e2e.mjs
```

脚本会：

1. 检查 Codex CLI 可用性与 runtime 可达性
2. 平台侧先调用 `prepare-context`，生成 `memory_delivery` 交付事实
3. 将准备好的长期记忆上下文和用户问题一起传给 `codex exec`
4. 解析 Codex JSONL 事件流，仅用于调试和质量观察
5. 查询 `observe/runs`，确认 session 对应的检索/注入轨迹
6. 断言通过只看平台交付事实和 runtime 轨迹，不用 Codex 回答自证

---

## 统一入口

统一检查入口（依赖检查 + runtime 可达性 + 桥接脚本链路）：

```bash
cd services/retrieval-runtime
npm run test:e2e
```

统一检查入口（依赖检查 + runtime 可达性 + 桥接脚本链路）：

```bash
cd services/retrieval-runtime
node tests/e2e/run-local-host-checks.mjs
```

---

## 验收通过标准

### 桥接链路（第一层）

- 真实桥接脚本能向 runtime 发出三阶段请求（session-start / prepare-context / finalize-turn）
- runtime 返回 `trace_id`，`observe/runs` 能查到对应轨迹

### 真实宿主对话注入验收（第二层，核心判定）

Claude 必须满足**双重判定**才算通过：

1. **runtime 轨迹存在**：`observe/runs` 接口返回该 session 的 `trigger_runs`、`recall_runs` 或 `injection_runs` 至少一项非空
2. **宿主最终回答体现注入记忆**：Claude 最终回答命中 >= 2 个注入记忆关键词

Codex 必须满足**平台观测判定**才算通过：

1. **平台交付事实存在**：脚本生成 `memory_delivery`，且 `host_context_delivered=true`
2. **runtime 轨迹存在**：`observe/runs` 接口返回该 session 的 `trigger_runs`、`recall_runs` 或 `injection_runs` 至少一项非空
3. Codex 最终回答只作为质量观察，不作为“已经收到记忆”的证明

关键词来自 `real-host-eval-utils.mjs` 中的 `INJECTION_SIGNAL_KEYWORDS`，对应 `TEST_MEMORY_SEEDS` 里的测试记忆内容：

- 用户偏好 TypeScript + 类型注释
- 项目正在迁移到 ESM / `.mjs` / `type:module`
- 用户喜欢简洁代码风格

---

## 辅助工具模块

`tests/e2e/real-host-eval-utils.mjs` 提供两个脚本共享的工具函数：

- `TEST_MEMORY_SEEDS`：测试记忆样本定义（需要预先种入 runtime）
- `INJECTION_SIGNAL_KEYWORDS`：期望在宿主最终回答中命中的关键词
- `fetchRuntimeRuns(baseUrl, sessionId)`：读取 `observe/runs`
- `assertRuntimeInjectionTrace(runs, sessionId)`：断言 runtime 注入轨迹存在
- `parseClaudeStreamOutput(rawStdout)`：从 Claude `stream-json` 输出提取文字
- `parseCodexJsonOutput(rawStdout)`：从 Codex JSONL 事件流提取文字
- `assertAnswerContainsInjectionSignals(answer)`：断言回答命中关键词

---

## 说明

这套测试不依赖仓库内 stub 数据，需要本地先把 runtime、存储、向量或降级路径准备好。

如果 Claude / Codex 需要登录或交互确认，属于正常现象，因此把它归到"实机验收"而不是完全无人值守测试。

**注意**：关键词命中断言依赖测试记忆被提前种入 runtime。如果 runtime 使用内存模式，重启后记忆会清空，需要重新种入。
