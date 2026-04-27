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
npm run build
npm run migrate:memory-llm-config -- --check path/to/.env
npm run migrate:memory-llm-config -- path/to/.env
```

脚本会：

- 原地替换支持的旧键名
- 保留原来的值和注释行
- 如果新键已经存在，就保留新键，不再重复写入旧键内容
- 如果同一个旧键重复出现，只迁移第一条，避免生成重复的新键

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

## 当前进度

- 这轮迁移任务先记到第 3 步
- 下一步补回滚测试

## 测试清单

先按阶段收口，避免把正常迁移和失败回滚混在一起看。

### 第 3 步已收口

| 编号 | 测试点 | 说明 |
|---|---|---|
| T1 | 键名替换 | 文本迁移能把 `WRITEBACK_LLM_*` 正确改成 `MEMORY_LLM_*`，包含 `WRITEBACK_LLM_CONFIG_PATH` → `CONTINUUM_MEMORY_LLM_CONFIG_PATH` |
| T2 | 去重规则 | 已覆盖“新键已存在时保留新键、旧键重复时只迁移第一条”的行为 |
| T3 | 文本保真 | 已覆盖注释、`export` 前缀、无关键和 `CRLF` 换行保留 |
| T4 | 单文件写回 | 已覆盖单文件原地写回，以及 `--check` 只检查不落盘 |
| T5 | CLI 基本行为 | 已覆盖 `--check`、`--help`、`--`、未知参数、缺失文件和多文件结果输出 |

### 第 4 步待补

| 编号 | 测试点 | 说明 |
|---|---|---|
| T6 | 多文件失败回滚 | 第二个文件写入失败时，前面已写成功的文件要回滚到原始内容 |
| T7 | 回滚顺序 | 回滚按逆序执行，确保最后写入的文件先恢复，避免半完成状态残留 |
| T8 | 回滚失败报错 | 回滚本身失败时，错误信息要同时带上原始写入失败和 `rollback failed` 明细 |
| T9 | 首次写入失败 | 首个文件写入失败时，不应尝试回滚未写入文件，也不应额外生成误导性的回滚错误 |
| T10 | 手工 smoke | 迁移补齐后做一轮 `--check`、真实迁移、`dependency-status` 和宿主页面展示联动 |

## 受影响范围

这次统一后的口径已经覆盖：

- `retrieval-runtime`
- `memory-native-agent`
- `visualization`

如果部署脚本、CI 或本地启动脚本里还残留 `WRITEBACK_LLM_*`，都需要一起改掉。
