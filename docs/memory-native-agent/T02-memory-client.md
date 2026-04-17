# T02 — retrieval-runtime HTTP 客户端

## 1. 目标

在 `services/memory-native-agent/src/memory-client/` 下封装一个**专用的 runtime HTTP 客户端**，
对 agent 主循环暴露三个方法：`sessionStartContext` / `prepareContext` / `finalizeTurn`，
并内置超时、错误归类、降级标记。

这是 agent 与记忆层之间唯一正式通道。

## 2. 前置依赖

- T01 已完成（有工程骨架）
- T03 已完成（runtime 已接受 `host: "memory_native_agent"`）

## 3. 交付物

### 3.1 文件清单

```
src/memory-client/
├── index.ts              # 导出 MemoryClient
├── client.ts             # MemoryClient 实现
├── schemas.ts            # zod 请求/响应 schema
├── errors.ts             # 客户端错误类型
└── __tests__/
    └── client.test.ts    # 使用 MSW 或 fastify mock
```

### 3.2 `MemoryClient` 公共接口

```ts
export interface MemoryClientConfig {
  baseUrl: string;              // 例如 http://127.0.0.1:4100
  requestTimeoutMs?: number;    // 默认 800ms（查询快路径约束）
  finalizeTimeoutMs?: number;   // 默认 1500ms（写回允许慢一点）
}

export class MemoryClient {
  constructor(config: MemoryClientConfig);

  sessionStartContext(req: SessionStartRequest): Promise<SessionStartResult>;
  prepareContext(req: PrepareContextInput): Promise<PrepareContextResult>;
  finalizeTurn(req: FinalizeTurnRequest): Promise<FinalizeTurnResult>;
  dependencyStatus(): Promise<DependencyStatus>;
  healthz(): Promise<HealthStatus>;
}
```

### 3.3 请求/响应类型

字段严格对齐 `services/retrieval-runtime/src/host-adapters/types.ts` 与 `src/api/schemas.ts`。

- 请求端 `host` 固定写死为 `"memory_native_agent"`（由 client 注入，调用方不传）。
- **响应字段以 runtime 实际返回为准**。开工第一步：`Read services/retrieval-runtime/src/runtime-service.ts` 的
  `prepareContext` / `sessionStartContext` / `finalizeTurn` 方法的真实返回形状，按实际字段定义 zod schema。
  下面列出的是**期望字段**，不是权威清单；不一致时以 runtime 代码为准：
  - `injection_block`（注入块）
  - `trace_id`（串轨迹）
  - `memory_mode_effective`（实际生效的 memory_mode）
  - `degraded`（布尔，是否处于降级）
  - `dependency_unavailable`（如有）

### 3.4 降级与错误语义

| 场景 | 行为 |
| :--- | :--- |
| 请求超时 | 抛 `MemoryTimeoutError`，调用方按降级处理（继续对话，无注入） |
| HTTP 4xx | 抛 `MemoryBadRequestError`，带服务端 `error.code` 与字段 |
| HTTP 5xx / 网络错误 | 抛 `MemoryUnavailableError` |
| 服务端返回 `dependency_unavailable` | 不抛错，返回 `{ degraded: true, injection_block: null }` |

遵循 `docs/architecture-independence.md` 第 5 节："依赖不可用时必须返回显式降级结果，不能无限等待"。

### 3.5 日志

- 使用结构化日志（可先用最小 console + 预留 pino 接口）
- 每次请求记录：`trace_id`、`phase`、`latency_ms`、`status`
- 不记录 `current_input` 与 `assistant_output` 原文（防泄漏）

## 4. 实施步骤

1. 用 `undici` 或内置 `fetch` 做 HTTP（优先 `undici` 的 `request`，性能可控）。
2. 定义 `schemas.ts`：zod 校验响应（防止 runtime 契约漂移时爆出不明错误）。
3. 实现 `client.ts`：三个业务方法 + healthz / dependencyStatus。
4. 封装 `withTimeout(promise, ms)` 工具。
5. 每个方法内部：
   - 拼 URL（`${baseUrl}/v1/runtime/...`）
   - POST JSON
   - 用 zod 校验响应
   - 失败分类抛错
6. 写测试：用 MSW 或自起一个 fastify mock 覆盖四种情况（正常 / 超时 / 5xx / degraded）。

## 5. 验收标准

- `npm test` 里 `memory-client` 用例全部通过，覆盖：
  - 正常 200 返回，响应结构校验通过
  - 超时抛 `MemoryTimeoutError`
  - 5xx 抛 `MemoryUnavailableError`
  - `degraded: true` 正常返回而不抛错
- 调用 `prepareContext` 时请求 body 的 `host` 字段固定是 `"memory_native_agent"`。
- 请求默认超时 ≤ 800ms，可覆盖。

## 6. 相关契约

- `docs/memory-module-contract.md` 第 5.1 / 5.2 / 5.3 节：接口字段
- `docs/architecture-independence.md` 第 5 节：降级容错约束
- `docs/api-contract.md`：HTTP 路径与字段
- `services/retrieval-runtime/src/host-adapters/types.ts`：请求 schema 源头

## 7. 不在范围内

- 重试策略（首版**不做自动重试**，交由 agent runner 决定是否重发）
- 本地持久化缓存
- 认证头（当前 single_local_user 不需要）
