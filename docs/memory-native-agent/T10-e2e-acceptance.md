# T10 — 端到端联调与验收测试

## 1. 目标

把 T01 ~ T09、T11 产出的模块拼起来，跑一条真实链路：
**浏览器打开 visualization `/agent` → mna HTTP/WS → retrieval-runtime → storage → 共享读模型 → visualization 观测页显示本会话轨迹**。
并用自动化 e2e 测试把首版验收标准固化下来。

## 1.1 当前状态

当前状态：进行中。

本轮已经补上的内容：

- 新增人工验收清单 `acceptance-checklist.md`
- 明确保留 `services/memory-native-agent/tests/e2e/README.md` 作为端到端测试资产入口
- 已有单测范围已经覆盖 HTTP、WebSocket、session-store、runner、providers、tools、MCP、visualization reducer、CLI 命令解析
- 已补 `services/memory-native-agent/tests/e2e/setup.ts`，可在测试期真实装配 `mna + retrieval-runtime + storage`
- 已补 5 条真实后端 e2e：
  - `happy-path.e2e.test.ts`
  - `degrade-runtime-down.e2e.test.ts`
  - `degrade-storage-down.e2e.test.ts`
  - `memory-mode-switch.e2e.test.ts`
  - `governance-roundtrip.e2e.test.ts`
- 已修正 `mna` 在 retrieval-runtime 不可达时的 `injection_banner.degraded` 降级标记，和验收语义对齐

本轮还没有补齐的内容：

- Playwright 浏览器用例的本机实跑验收
- record/replay provider 驱动的确定性 UI / API e2e

## 2. 前置依赖

- T01 ~ T09 完成
- T11 visualization 前端完成

## 3. 交付物

### 3.1 文件清单

```
services/memory-native-agent/
├── tests/
│   ├── e2e/
│   │   ├── setup.ts                      # 已完成：测试期装配 mna + runtime + storage + provider stub
│   │   ├── happy-path.e2e.test.ts        # 已完成
│   │   ├── degrade-runtime-down.e2e.test.ts   # 已完成
│   │   ├── degrade-storage-down.e2e.test.ts   # 已完成
│   │   ├── memory-mode-switch.e2e.test.ts     # 已完成
│   │   └── governance-roundtrip.e2e.test.ts   # 已完成
│   └── fixtures/
│       ├── model-record-replay/
│       └── mcp-fixture-server.mjs

services/visualization/tests/agent-e2e/
├── playwright.config.ts
├── global-setup.mjs             # 已完成：测试期真实装配 visualization + mna + runtime + storage
├── dev-stack.ts                 # 已完成：独立拉起 UI e2e 依赖栈
└── agent-ui.spec.ts             # 已完成：首条真实浏览器用户流

docs/memory-native-agent/
└── acceptance-checklist.md       # 新增：人工验收清单
```

### 3.2 测试场景

#### E2E-01 Happy Path (mna 后端 API 层)

1. 启动 runtime + storage（用 `packages/continuum-cli` 的 start 或 test fixture）
2. 启动 mna server + record/replay provider
3. 通过 mna HTTP/WS 跑两轮对话：
   - 第一轮让 agent 记下一个稳定偏好（"我偏好用 TypeScript"）
   - 第二轮在新 session 里问"我偏好什么语言"，期望注入块包含该记忆
4. 断言：
   - 第一轮 `finalize-turn` 响应里有至少 1 条 `accepted` 写回
   - 第二轮 `prepare-context` 响应的 `injection_block` 含有"TypeScript"关键字
   - 两轮的 `trace_id` 能在 `GET /v1/runtime/observe/runs` 查到

#### E2E-02 runtime 不可达降级

1. 不启动 runtime，直接启 mna
2. 通过 WS 对话一轮
3. 断言：
   - `injection_banner` 事件 `degraded=true`
   - `turn_end` 正常到达
   - mna 进程不崩溃
   - `GET /v1/agent/dependency-status` 输出 runtime unavailable

#### E2E-03 storage 不可达降级

1. 启动 runtime 但 storage 不可达（kill storage 进程）
2. mna 对话
3. 断言：
   - prepare-context 返回 degraded
   - finalize-turn 返回 dependency_unavailable 但不阻塞下一轮
   - storage 恢复后后续轮次恢复正常

#### E2E-04 memory_mode 切换

1. 启动 mna，默认 `workspace_plus_global`
2. 写入一条 `user` scope 记忆（偏好）
3. `POST /v1/agent/sessions/:id/mode` 切到 `workspace_only`
4. 新开一轮问"我偏好什么"
5. 断言：injection 里**不含**该偏好（因为 user scope 被屏蔽）

#### E2E-05 治理闭环

1. 正常写入一条错误记忆（通过对话注入一条错误的"事实"）
2. 通过 `GET /v1/storage/...` 或 visualization API 找到该记录
3. 调 `invalidate` 治理动作
4. 再开一轮问相关问题
5. 断言：injection 不再包含该记忆（对齐 `current-phase-closure-plan.md` 7.6 节）

### 3.3 测试基础设施

- **runtime + storage 启停**：优先复用 `packages/continuum-cli` 的 docker start。如果 e2e 用例需要 fine-grained 控制，用 testcontainers 起 pg + redis + 起 tsx 进程。
- **embedding mock**：embedding 服务走一个 deterministic stub（对文本做哈希映射成固定向量），保证测试稳定。
- **模型 record/replay**：使用 T12 第 6 节定义的 fixture 格式和 `MNA_PROVIDER_MODE` 开关。首次录制：开发者本地 `MNA_PROVIDER_MODE=record MNA_REC_TARGET=openai-compatible npm test` 跑一次真模型；之后 CI 走 `MNA_PROVIDER_MODE=replay`。
- **MCP fixture**：一个极简的 echo MCP server 用于测 `mcp_call`。

### 3.4 前端 UI e2e（Playwright）

除了后端 API 层的 e2e，追加一组浏览器 e2e：

- **UI-01** 打开 `/agent`，创建 session，输入消息看到流式回复
- **UI-02** 触发 `fs_write` 工具调用，弹出 ConfirmDialog，点"允许"后文件真的写入
- **UI-03** 关闭 mna 进程，页面显示离线提示；重启 mna 后自动重连
- **UI-04** 在页面切换 `memory_mode` 下拉，下一轮请求体 `memory_mode` 字段变更

Playwright 跑在 visualization 启动的环境下，mna 用真实后端进程（而非 mock），model provider 用 record/replay。

### 3.5 人工验收清单（`acceptance-checklist.md`）

写一份可打勾的 checklist，覆盖：

- [ ] `node bin/mna-server.mjs` 启动后监听 127.0.0.1:4193
- [ ] `GET /healthz` 返回 200
- [ ] `GET /v1/agent/dependency-status` 在正常环境显示 runtime ok
- [ ] 浏览器打开 `/agent` 能创建 session 并对话
- [ ] 首次对话能看到 InjectionBanner
- [ ] 关闭 runtime 后仍能对话（降级）
- [ ] mna 进程 `SIGINT` 干净退出
- [ ] 切 `memory_mode` 立即生效（下一轮 `injection_banner` 事件字段变更）
- [ ] 会话的 `trace_id` 能在 visualization `/runs` 页面查到
- [ ] `visualization` 宿主维度筛选里出现 `memory_native_agent`（如已支持）
- [ ] shell_exec 黑名单命令在前端被拒
- [ ] fs_write 首次执行前弹 ConfirmDialog

## 4. 实施步骤

1. 先写 `setup.ts`，把启停和 stub 基础设施打通。
2. 先写 E2E-01 happy path，让 mna 后端模块真正拼接。
3. 依次补 E2E-02 ~ E2E-05（后端 API 层）。
4. 在 visualization 里加 Playwright 配置，跑 UI-01 ~ UI-04。
5. 每个 e2e 用例要在本地 `npm run test:e2e` 能跑通。
6. 整理 acceptance-checklist.md，结合自动化用例标注哪些是人工复核项。

## 5. 验收标准

- 5 条后端 e2e + 4 条 UI e2e 在本地稳定通过（连跑 3 次不出 flaky）。
- 人工 checklist 全绿后视为首版可发布。
- `RELEASE.md` 记录首版版本号、依赖版本矩阵（runtime / storage / visualization / mna）、限制条款。

### 5.1 当前验收结果

- 自动化层面：
  - `services/memory-native-agent` 已通过 `npm run check`
  - `services/memory-native-agent` 已通过 `npm test`
  - 已落地并跑通 5 条真实后端 e2e：`happy path / runtime down / storage down / memory_mode switch / governance roundtrip`
  - `services/visualization` 已补 Playwright 配置、真实依赖装配和首条 `agent-ui.spec.ts`
- 人工层面：已整理成 `acceptance-checklist.md`
- 未完成项仍然存在：本机 `Playwright` 浏览器尚未安装，`agent-ui.spec.ts` 未完成实际通过验证；record/replay provider 驱动的确定性浏览器验收仍待补

## 6. 相关契约

- `docs/current-phase-closure-plan.md` 第 8.4 节：自动化契约检查（端到端验收测试）
- `docs/architecture-independence.md` 第 5 / 6 节：降级 / 验收
- `docs/memory-module-contract.md` 第 7 / 8 / 9 节：写回 / 上下文预算 / 性能约束

## 7. 不在范围内

- 性能压测（留给后续独立任务）
- 跨平台 CI 矩阵（首版 Windows + macOS + Linux 手动验证即可）
- 发布自动化（`npm publish` / CHANGELOG 自动生成）
