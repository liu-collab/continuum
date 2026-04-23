# 记忆编排器工程回归测试说明

这套测试的定位是：

- 用真实 `prompt`（提示词）和真实 `schema`（结构约束）验证记忆编排器的工程回归。
- 重点看结构化输出、策略稳定性、模型兼容性和指标趋势。
- 它不是默认全量单测的一部分，也不直接等同于线上真实效果验收。

---

## 1. 为什么默认不进全量测试

这套测试和普通单测不一样：

- 样本量大，当前是 `100` 条工程回归样本。
- 会覆盖多类指标，包括召回、写回、治理、关系、推荐、知识提取、效果反馈。
- 真实评测还会访问本地配置的记忆模型，耗时明显高于普通单测。

所以现在默认 `npm test` 不会跑这套大回归，只跑普通单测。

如果需要验证这套工程回归，必须显式执行单独命令。

---

## 2. 文件位置

- 回归样本定义：`services/retrieval-runtime/src/cli/memory-orchestrator-real-eval-cases.ts`
- 评测脚本：`services/retrieval-runtime/src/cli/memory-orchestrator-real-eval.ts`
- 样本结构与汇总单测：`services/retrieval-runtime/tests/memory-orchestrator-real-eval.test.ts`
- 默认 `vitest` 配置：`services/retrieval-runtime/vitest.config.ts`
- 专用 `vitest` 配置：`services/retrieval-runtime/vitest.memory-orchestrator-real-eval.config.ts`
- 最新评测报告：
  - `services/retrieval-runtime/docs/memory-orchestrator-real-llm-eval.md`
  - `services/retrieval-runtime/docs/memory-orchestrator-real-llm-eval.json`

---

## 3. 如何使用

### 3.1 跑普通单测

这条命令不会跑工程回归大样本：

```bash
npm test
```

### 3.2 只跑工程回归测试的单测

这条命令只跑样本构建、评分汇总、基线对比这些测试逻辑：

```bash
npm run test:memory-orchestrator-eval
```

适合在下面这些场景用：

- 改了评测脚本
- 改了样本定义
- 改了评分逻辑
- 想确认默认全量测试没有把它带进去

### 3.3 跑真实模型离线评测

这条命令会真的调用本地记忆模型：

```bash
npm run eval:memory-orchestrator-real -- --base-url http://localhost:8090/v1 --model gpt-5.4 --protocol openai-compatible --timeout-ms 45000
```

常用参数：

- `--base-url`
  记忆模型接口地址
- `--api-key`
  接口密钥；不传时会尝试读取 `~/.continuum/managed/mna/config.json`
- `--model`
  记忆模型 ID，比如 `gpt-5.4`
- `--protocol`
  当前支持 `openai-compatible` 和 `anthropic`
- `--timeout-ms`
  单次模型请求超时
- `--concurrency`
  并发数；样本量变大后可以按本地服务能力调整
- `--output-base`
  输出报告文件前缀
- `--update-baseline`
  用本次结果更新基线

---

## 4. 输出内容

真实评测完成后会生成两份文件：

- Markdown 报告
  适合人工查看每个指标和失败样本
- JSON 结果
  适合后续比较、统计或做基线差异分析

当前会输出：

- `rate`（通过率）
- `avgScore`（平均分）
- `errorCounts`（错误分布）
- 每条样本的原始输出、解析结果、失败原因

---

## 5. 建议的使用方式

推荐按下面的节奏用：

1. 日常开发只跑 `npm test`
2. 改了记忆编排器评测逻辑后，跑 `npm run test:memory-orchestrator-eval`
3. 改了 `prompt`、`schema`、模型兼容层或评测样本后，再跑 `npm run eval:memory-orchestrator-real`

这样可以避免每次都把大样本回归带进全量测试。

---

## 6. 结果怎么理解

这套测试更接近：

- `engineering regression`（工程回归）
- `policy benchmark`（策略基准）

它不直接等同于：

- 线上真实用户采纳率
- 真实人工标注效果
- 产品发布验收的最终结论

所以更合适的用法是：

- 用它看“改动有没有把结构化输出、策略稳定性和模型兼容性搞坏”
- 再结合人工标注或线上数据看最终效果
