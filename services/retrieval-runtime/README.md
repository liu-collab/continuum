# retrieval-runtime 服务初始化

## 技术选型

- 语言：`TypeScript`
- 运行时：`Node.js 22 LTS`
- Web 框架：`Fastify`
- 数据访问：`pg`
- 请求校验：`Zod`
- 向量能力：外部 `OpenAI-compatible embeddings API`
- 日志：`Pino`
- 测试：`Vitest`

## 这样选的原因

- 这一层主要是运行时编排，不是重写数据库模型。
- 它只读 `storage` 发布的共享读模型，所以这里不希望引入和 `storage` 私有写模型强绑定的 ORM。
- 用 `pg + 明确 SQL` 更容易把“硬过滤 + 软排序 + 重排”写清楚。
- `Fastify` 适合做宿主接入 HTTP 接口，也适合后续接 `Claude Code`、`Codex`、自研 agent。

## 这一层目录骨架

```text
retrieval-runtime/
├── .env.example
├── src/
│   ├── api/
│   ├── injection/
│   ├── observability/
│   ├── query/
│   ├── trigger/
│   └── writeback/
└── tests/
```

## 各目录先放什么

- `src/api/`
  放 `prepare-context`、`finalize-turn`、观测接口

- `src/trigger/`
  放触发判断、冷却规则、语义兜底

- `src/query/`
  放共享读模型查询、重排、embedding 调用

- `src/injection/`
  放 `MemoryPacket` 和 `InjectionBlock` 生成逻辑

- `src/writeback/`
  放写回候选提取和 `storage` 提交逻辑

- `src/observability/`
  放运行轨迹落库、指标输出、依赖状态检查

## 后续第一批代码

建议直接按这个顺序写：

1. `prepare-context` 接口
2. `trigger-engine`
3. `query-engine`
4. `packet-builder`
5. `injection-engine`
6. `finalize-turn` 接口
7. `writeback-engine`
8. 运行轨迹与指标接口
