# T01 — mna 包骨架与 HTTP 服务初始化

## 1. 目标

在 `services/memory-native-agent/` 下建立一套可构建、可测试、可本地启动的 Node.js + TypeScript 工程骨架，
并提供一个能通过 `node bin/mna-server.mjs` 起来的最小 HTTP 服务进程。

不包含任何业务实现，只包含：目录结构、依赖、构建、测试、HTTP 服务桩（含 `/healthz`）。

## 2. 前置依赖

无。

## 3. 交付物

### 3.1 目录与文件清单

```
services/memory-native-agent/
├── bin/
│   └── mna-server.mjs                # HTTP 服务入口
├── src/
│   ├── index.ts                      # 导出 start()/stop()
│   ├── server.ts                     # Fastify 实例创建 + 基础路由
│   ├── http/
│   │   └── .gitkeep
│   ├── runner/
│   │   └── .gitkeep
│   ├── providers/
│   │   └── .gitkeep
│   ├── tools/
│   │   └── .gitkeep
│   ├── mcp-client/
│   │   └── .gitkeep
│   ├── memory-client/
│   │   └── .gitkeep
│   ├── config/
│   │   └── .gitkeep
│   └── shared/
│       └── types.ts                  # 占位 + 版本常量
├── tests/
│   └── smoke.test.ts                 # 起服务 → GET /healthz → 200
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
├── README.md
└── RELEASE.md
```

### 3.2 `package.json` 关键字段

- `name`: `@jiankarlin/memory-native-agent`
- `version`: `0.1.0`
- `type`: `"module"`
- `engines.node`: `">=22.0.0"`
- `bin.mna-server`: `./bin/mna-server.mjs`
- `files`: `["bin/", "dist/", "README.md", "RELEASE.md"]`
- `scripts`:
  - `build`: `tsc -p tsconfig.json`
  - `check`: `tsc --noEmit -p tsconfig.json`
  - `dev`: `tsx watch bin/mna-server.mjs`
  - `start`: `node bin/mna-server.mjs`
  - `test`: `vitest run`
  - `test:watch`: `vitest`

首版基础依赖（必装）：

- `fastify` — HTTP 框架（与 retrieval-runtime 一致）
- `@fastify/websocket` — WebSocket 支持（T08 要用，这里先装上）
- `zod` — schema 校验
- `pino` — 结构化日志

dev 依赖：`@types/node`、`tsx`、`typescript`、`vitest`。

业务依赖（后续任务引入）：`undici`、`yaml`、`@modelcontextprotocol/sdk`、各 provider SDK。

### 3.3 `tsconfig.json`

继承 `services/retrieval-runtime/tsconfig.json` 的口径：
`module: nodenext`、`target: es2023`、`strict: true`、`outDir: dist`。

### 3.4 `src/server.ts`

最小 Fastify 实例：

```ts
import Fastify, { FastifyInstance } from "fastify";

export function createServer(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.get("/healthz", async () => ({
    status: "ok",
    version: "0.1.0",
    dependencies: {
      retrieval_runtime: "unknown",   // 占位，T02 后补齐
    },
  }));
  return app;
}
```

### 3.5 `src/index.ts`

```ts
export async function start({ port }: { port: number }) {
  const app = createServer();
  await app.listen({ port, host: "127.0.0.1" });
  return app;
}
```

默认端口 **`4193`**（约定：runtime 4100 / visualization 3000 / mna 4193，避免冲突）。

### 3.6 `bin/mna-server.mjs`

- 读 `MNA_PORT` 环境变量，无则用 4193
- 调 `start()`
- 处理 `SIGINT` / `SIGTERM` 优雅关闭

### 3.7 `tests/smoke.test.ts`

- 启服务 → HTTP GET `/healthz` → 断言 `status === "ok"`
- 关服务

### 3.8 `README.md`

写三段：模块定位（引用 `docs/memory-native-agent/README.md`）、本地启动方式、如何跑测试。

## 4. 实施步骤

1. 创建目录骨架与 `.gitkeep`。
2. 写 `package.json`，`npm install` 生成 lockfile。
3. 写 `tsconfig.json` 与 `vitest.config.ts`（复制 `services/retrieval-runtime/` 对应文件微调）。
4. 写 `src/server.ts`、`src/index.ts`、`bin/mna-server.mjs`、`tests/smoke.test.ts`。
5. 跑 `npm run check`、`npm run build`、`npm test`，全绿。
6. 跑 `node bin/mna-server.mjs &`，`curl http://127.0.0.1:4193/healthz` 返回 `{"status":"ok",...}`。

## 5. 验收标准

- `npm run check / build / test` 三项全部通过。
- `node bin/mna-server.mjs` 能起来监听 127.0.0.1:4193。
- `GET /healthz` 返回 200，结构符合 3.4。
- `SIGINT` 能在 1s 内优雅退出，不残留端口占用。
- 工程规范（ESM、Node 22、strict TS、Fastify）与 `services/retrieval-runtime` 保持一致。

## 6. 相关契约

- `docs/architecture-independence.md` 第 3.3 节：运行解耦、本服务独立启动
- `docs/architecture-independence.md` 第 3.3.1 节：`liveness` / `readiness` / `dependencies` 三类状态（T01 只先做 liveness，另两类在后续任务补）
- `services/retrieval-runtime/package.json`：工程口径样板

## 7. 不在范围内

- 业务接口（会话创建 / turn 提交 / 流式输出）——T08
- 任何业务逻辑
- CI / 发布流程
- CORS 配置（T08 再加，目前 smoke 测试走进程内请求）
