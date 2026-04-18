# T03 — retrieval-runtime 新增 memory_native_agent adapter

## 当前状态

- 状态：已完成
- 完成时间：2026-04-18
- 验证结果：已补 `memory_native_agent` adapter、HTTP schema、宿主注册与运行时测试；`npm run check`、`npm test` 已通过
- 代码位置：`services/retrieval-runtime/`

## 1. 目标

在 `services/retrieval-runtime/` 里新增 `MemoryNativeAgentAdapter`，并把 host 枚举 `memory_native_agent` 正式加入 API schema 与适配器注册表。

这是**跨服务改动中唯一必须动到 runtime 的任务**。保持改动最小，不触碰 runtime 主链路逻辑。

## 2. 前置依赖

无。可与 T01 并行。

## 3. 交付物

### 3.1 新增文件

- `services/retrieval-runtime/src/host-adapters/memory-native-agent-adapter.ts`

### 3.2 修改文件

- `services/retrieval-runtime/src/host-adapters/types.ts`
  - `prepareContextInputSchema.host` 的 enum 追加 `"memory_native_agent"`
  - `finalizeTurnInputSchema.host` 的 enum 追加 `"memory_native_agent"`
- `services/retrieval-runtime/src/host-adapters/index.ts`
  - 导入并注册 `MemoryNativeAgentAdapter`
- `services/retrieval-runtime/src/shared/types.ts`
  - `HostKind` union 追加 `"memory_native_agent"`
- `services/retrieval-runtime/src/app.ts`
  - `session-start-context` 路由的 `payloadSchema.host` enum 追加 `"memory_native_agent"`
- `services/retrieval-runtime/tests/runtime-service.test.ts`（或新增独立 test 文件）
  - 补 1 条用例：`host: "memory_native_agent"` 走通 `prepareContext` + `finalizeTurn`

### 3.3 `MemoryNativeAgentAdapter` 实现要点

参照 `src/host-adapters/custom-agent-adapter.ts` 结构。首版行为与 `CustomAgentAdapter` 一致：

- `toTriggerContext(input)`：把 `PrepareContextInput` 或 `SessionStartRequest` 映射为 `TriggerContext`，`host` 字段固定为 `"memory_native_agent"`。
- `toFinalizeInput(input)`：映射 `FinalizeTurnRequest` 为 `FinalizeTurnInput`，`host` 字段固定为 `"memory_native_agent"`。

与 `custom_agent` 分开的原因：

- 预留未来"memory-native-agent 专有 phase 或 trigger 规则"的扩展点
- 可观测面可以按 host 区分统计（运行轨迹页能看到是哪个宿主）
- 契约上让 runtime 明确知道消费者身份，便于 `visualization` 的宿主维度筛选

## 4. 实施步骤

1. **先 grep host 枚举的所有出现点**：
   ```bash
   rg '"claude_code_plugin"|"codex_app_server"|"custom_agent"' services/retrieval-runtime/
   ```
   除了 3.2 列出的文件，可能还有 `observability/`、日志 tag、metrics 维度等地方硬编码枚举。全部补上 `memory_native_agent`。
2. 复制 `custom-agent-adapter.ts`，重命名类为 `MemoryNativeAgentAdapter`，把每一处 `"custom_agent"` 字面量替换为 `"memory_native_agent"`。
2. 改 `shared/types.ts` 里的 `HostKind`：
   ```ts
   export type HostKind =
     | "claude_code_plugin"
     | "codex_app_server"
     | "custom_agent"
     | "memory_native_agent";
   ```
3. 改 `host-adapters/types.ts` 两个 zod schema 的 host enum。
4. 改 `app.ts` 内 `session-start-context` 的内联 schema host enum（与 `prepareContextInputSchema` 同步）。
5. 改 `host-adapters/index.ts`：
   ```ts
   import { MemoryNativeAgentAdapter } from "./memory-native-agent-adapter.js";
   // ...
   export const hostAdapters = {
     claude_code_plugin: new ClaudeCodeAdapter(),
     codex_app_server: new CodexAppServerAdapter(),
     custom_agent: new CustomAgentAdapter(),
     memory_native_agent: new MemoryNativeAgentAdapter(),
   };
   ```
6. 在 `tests/` 里加一个最小用例：给 `runtimeService.prepareContext(adapter.toTriggerContext({ host: "memory_native_agent", ... }))` 传合法入参，断言返回 `injection_block` 或空结果结构符合契约。
7. `npm run check && npm test` 全绿。

## 5. 验收标准

- TypeScript 编译通过。
- 既有用例（claude_code_plugin、codex_app_server、custom_agent）全部仍然通过。
- 新用例至少验证 `memory_native_agent` 枚举值能被 `prepareContextInputSchema.parse` 接受。
- `GET /healthz` 输出不变。
- 无任何 runtime 主链路逻辑被改动（trigger-engine、query-engine、packet-builder、writeback 都不动）。

## 6. 相关契约

- `docs/memory-module-contract.md` 第 5.1、5.2、5.3 节：检索 / 注入 / 写回接口字段
- `docs/api-contract.md`：正式对外 host 枚举需要同步（见本任务第 7 节）
- `docs/retrieval/retrieval-runtime-service-design.md` 第 5、6 节

## 7. 文档回写要求

完成代码改动后，同步以下文档：

- `docs/api-contract.md`：`host` 枚举值列表补 `memory_native_agent`
- `docs/retrieval/retrieval-runtime-service-design.md`：如第 5 节列了支持的 host，补一条
- `docs/retrieval/agent-host-integration-research.md`：在宿主对比表末尾加一列 `memory-native-agent`，首版行为与其他宿主的对照

如果发现 `api-contract.md` 未列 host 枚举，则视为现状允许新增，不必回写。

## 8. 不在范围内

- runtime 主链路行为差异（首版与 custom_agent 行为一致）
- visualization 宿主维度筛选能力（后续 T10 或单独任务）
- 共享读模型字段变更
