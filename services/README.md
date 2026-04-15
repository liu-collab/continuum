# services 目录说明

这里放三套独立服务的代码目录骨架：

- `storage`
- `retrieval-runtime`
- `visualization`

这三层现在统一按下面的技术口径初始化：

## 统一约束

- 三个服务独立开发、独立部署、独立运行
- 不共享运行时代码
- 共享的只有正式契约：
  - REST 接口契约
  - 数据库共享读模型契约
  - 指标与事件字段契约

## 技术选型结论

### 1. storage

- 语言：`TypeScript`
- 运行时：`Node.js 22 LTS`
- Web 框架：`Fastify`
- 数据库：`PostgreSQL 16 + pgvector`
- 队列：`Redis + BullMQ`
- 数据访问：`Drizzle ORM + 原生 SQL`
- 日志：`Pino`
- 测试：`Vitest`

### 2. retrieval-runtime

- 语言：`TypeScript`
- 运行时：`Node.js 22 LTS`
- Web 框架：`Fastify`
- 数据访问：`pg`（只读共享读模型时尽量直接写 SQL）
- 向量能力：调用外部 `OpenAI-compatible embeddings API`
- 校验：`Zod`
- 日志：`Pino`
- 测试：`Vitest`

### 3. visualization

- 语言：`TypeScript`
- 框架：`Next.js`
- UI：`React + Tailwind CSS + shadcn/ui`
- 数据请求：`TanStack Query`
- 表格：`TanStack Table`
- 图表：`ECharts`
- 校验：`Zod`

## 为什么这样选

- `storage` 和 `retrieval-runtime` 统一用 `TypeScript + Fastify`，后续开发快，接口层风格一致，但仍然保持服务独立。
- `storage` 必须强依赖 `PostgreSQL + pgvector`，因为这层既要结构化存储，又要发布可做向量排序的共享读模型。
- `retrieval-runtime` 不用 ORM 绑定共享读模型，主要是为了降低它和 `storage` 私有实现的耦合。
- `visualization` 独立用 `Next.js`，因为它天然适合做服务端数据聚合页面和前端交互页面混合场景。

## 目录使用方式

- 每个服务目录下先放自己的 `README.md`、环境变量样例和代码骨架
- 后续直接在各自目录内继续写实现，不需要先改整体目录结构
