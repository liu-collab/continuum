# memory llm 配置迁移说明

这次迁移的目标很直接：

- 把旧的 `WRITEBACK_LLM_*` 配置统一改成 `MEMORY_LLM_*`
- 让召回、写回、治理都复用同一套记忆模型配置
- 不再兼容旧键名

## 需要替换的环境变量

按下面这组映射替换：

| 旧键 | 新键 |
|---|---|
| `WRITEBACK_LLM_BASE_URL` | `MEMORY_LLM_BASE_URL` |
| `WRITEBACK_LLM_MODEL` | `MEMORY_LLM_MODEL` |
| `WRITEBACK_LLM_API_KEY` | `MEMORY_LLM_API_KEY` |
| `WRITEBACK_LLM_PROTOCOL` | `MEMORY_LLM_PROTOCOL` |
| `WRITEBACK_LLM_TIMEOUT_MS` | `MEMORY_LLM_TIMEOUT_MS` |
| `WRITEBACK_LLM_EFFORT` | `MEMORY_LLM_EFFORT` |
| `WRITEBACK_LLM_MAX_TOKENS` | `MEMORY_LLM_MAX_TOKENS` |
| `WRITEBACK_LLM_CONFIG_PATH` | `CONTINUUM_MEMORY_LLM_CONFIG_PATH` |

下面这些键继续保留，不需要改名：

- `WRITEBACK_LLM_REFINE_MAX_TOKENS`
- `WRITEBACK_MAX_CANDIDATES`
- `WRITEBACK_MAINTENANCE_*`
- `WRITEBACK_GOVERNANCE_*`

它们描述的是具体子流程预算和策略，不是记忆模型连接配置。

## 推荐做法

如果你是 `.env` 或部署环境变量文件迁移，直接运行：

```bash
node scripts/migrate-memory-llm-config.mjs path/to/.env
```

脚本会：

- 原地替换支持的旧键名
- 保留原来的值和注释行
- 如果新键已经存在，就保留新键，不再重复写入旧键内容

## 一个最小例子

迁移前：

```env
WRITEBACK_LLM_BASE_URL=https://api.openai.com/v1
WRITEBACK_LLM_MODEL=gpt-5-mini
WRITEBACK_LLM_API_KEY=example-key
```

迁移后：

```env
MEMORY_LLM_BASE_URL=https://api.openai.com/v1
MEMORY_LLM_MODEL=gpt-5-mini
MEMORY_LLM_API_KEY=example-key
```

## 迁移后检查项

至少确认这几项：

1. `retrieval-runtime` 能读到 `MEMORY_LLM_BASE_URL` 和 `MEMORY_LLM_MODEL`
2. `/v1/runtime/dependency-status` 里 `memory_llm` 不再是 `unavailable`
3. 宿主配置页面里展示的是 `memory llm`

## 受影响范围

这次统一后的口径已经覆盖：

- `retrieval-runtime`
- `memory-native-agent`
- `visualization`

如果部署脚本、CI 或本地启动脚本里还残留 `WRITEBACK_LLM_*`，都需要一起改掉。
