# storage 服务初始化

## 技术选型

- 语言：`TypeScript`
- 运行时：`Node.js 22 LTS`
- Web 框架：`Fastify`
- 数据库：`PostgreSQL 16 + pgvector`
- 队列：`Redis + BullMQ`
- 数据访问：`Drizzle ORM + 原生 SQL`
- 日志：`Pino`
- 测试：`Vitest`

## 这样选的原因

- 这一层主要是写入、去重、合并、冲突治理和读模型投影，核心是 IO 和数据一致性，不需要复杂框架。
- `Fastify` 足够轻，适合拆同步 API 和异步 worker。
- `PostgreSQL + pgvector` 可以同时承接正式写模型和共享读模型。
- `BullMQ` 直接把“接收写回”和“后台处理写入”拆开，符合我们之前定的写入异步化方案。
- `Drizzle` 适合把表结构和 SQL 写得明确，不会把向量和 JSONB 查询藏起来。

## 这一层目录骨架

```text
storage/
├── .env.example
├── migrations/
├── src/
│   ├── api/
│   ├── db/
│   ├── domain/
│   └── jobs/
└── tests/
```

## 各目录先放什么

- `src/api/`
  放 `writeback-api`、治理接口、观测接口

- `src/db/`
  放数据库连接、事务边界、仓储实现、读模型投影

- `src/domain/`
  放 `normalizer`、`merge-engine`、`conflict-engine`、`governance-engine`

- `src/jobs/`
  放异步 worker、重试、死信处理

- `migrations/`
  放正式表和共享读模型的数据库迁移

- `tests/`
  放公开接口测试、去重规则测试、冲突规则测试

## 后续第一批代码

建议直接按这个顺序写：

1. 数据库迁移
2. `writeback-api`
3. `memory_write_jobs` worker
4. `normalizer`
5. `merge-engine`
6. `read-model-projector`
