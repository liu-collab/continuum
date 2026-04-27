# 真实用户体验 A/B 评测

这套评测用于替代原先只靠关键词命中的“注入验收”。它跑 100 个自然任务，对比：

- A 组：不开启记忆
- B 组：调用 `retrieval-runtime` 获取注入块后再回答

然后用本地模型做盲评。评审模型只看到同一任务的两个回答，不知道哪个是 A/B。

## 文件

- `tasks.mjs`：100 个任务，按 10 类场景 × 10 个变体组织
- `run-ab-eval.mjs`：轻量离线 A/B，直接调用本地回答模型
- `run-real-host-ab-eval.mjs`：真实宿主 A/B，实际启动 `Claude Code` 或 `Codex`
- `real-host-runner.mjs`：真实宿主启动与输出解析
- `openai-compatible-client.mjs`：本地 OpenAI-compatible 模型客户端

## 覆盖场景

1. `global_preference`：全局偏好是否自然生效
2. `workspace_convention`：工作区规则是否生效
3. `task_continuation`：跨会话任务续接
4. `global_vs_workspace_conflict`：全局偏好与工作区规则冲突
5. `task_switch_isolation`：新任务是否避免旧任务污染
6. `stale_memory`：是否使用更新后的规则
7. `correction_recovery`：用户纠正后是否恢复
8. `irrelevant_no_memory`：无关问题是否保持安静
9. `multi_turn_tool_task`：复杂任务中同时使用规则和进度
10. `writeback_quality`：新稳定偏好或任务状态是否能进入写回检查

## 运行：真实宿主模式

先启动 `storage` 和 `retrieval-runtime`，并确认本地模型提供 OpenAI-compatible `/v1/chat/completions`。

默认会读取 `services/retrieval-runtime/.env.real-user-experience.local`。这个文件已被 `.gitignore` 忽略，用来放本机评测配置：

```bash
EVAL_MODEL_BASE_URL=http://localhost:8090/v1
EVAL_MODEL_API_KEY=<your-local-model-key>
EVAL_JUDGE_MODEL=gpt-5.4
MEMORY_RUNTIME_BASE_URL=http://127.0.0.1:3002
STORAGE_API_BASE_URL=http://127.0.0.1:3001
```

真实宿主模式会实际启动本机的 `Claude Code` 或 `Codex` 客户端：

```bash
cd services/retrieval-runtime

$env:EVAL_MODEL_BASE_URL="http://127.0.0.1:11434/v1"
$env:EVAL_JUDGE_MODEL="qwen2.5:32b"
$env:MEMORY_RUNTIME_BASE_URL="http://127.0.0.1:3002"

npm run eval:real-user-experience:host -- --host claude --limit 100
npm run eval:real-user-experience:host -- --host codex --seed --limit 100
```

说明：

- Claude 组通过临时 `.claude/settings.local.json` 配置真实 hook，B 组会自动触发 `memory-bridge.mjs`。
- Codex 组不注册 MCP server 作为主链路。B 组由评测平台先调用 `prepare-context`，再把准备好的长期记忆上下文通过 stdin 强制传给 `codex exec`。结果里会记录 `memory_delivery` 平台交付事实；`mcp_calls` 仅保留为调试统计，不作为主指标。跑 Codex 前需要带 `--seed`，确保任务里的 `seed_memories` 已进入 storage/read model。

如果只想先播种真实宿主评测记忆：

```bash
npm run eval:real-user-experience:host -- --host codex --seed-only --limit 100
```

## 运行：任务集结构测试

这个入口只检查任务集结构和固定约定，不启动真实宿主，也不调用模型：

```bash
npm run test:real-user-experience
```

## 运行：轻量离线模式

轻量模式不启动真实 Claude/Codex，只用本地回答模型模拟宿主侧回答，适合快速调任务集和评审器。

```bash
cd services/retrieval-runtime

$env:EVAL_MODEL_BASE_URL="http://127.0.0.1:11434/v1"
$env:EVAL_ANSWER_MODEL="qwen2.5-coder:14b"
$env:EVAL_JUDGE_MODEL="qwen2.5:32b"
$env:MEMORY_RUNTIME_BASE_URL="http://127.0.0.1:3002"
$env:STORAGE_API_BASE_URL="http://127.0.0.1:3001"

npm run eval:real-user-experience -- --seed --limit 100 --concurrency 1
```

如果只想先播种记忆：

```bash
npm run eval:real-user-experience -- --seed-only
```

## 输出

轻量模式默认写到 `docs/real-user-experience-eval/`，真实宿主模式默认写到 `docs/real-user-experience-host-eval/`：

- `ab-results.json` / `<host>-ab-results.json`：完整结果，包含模型、输入、A/B 输出、runtime 轨迹、盲评结果
- `ab-results.jsonl`：逐任务一行，便于后续分析
- `summary.json`：汇总指标

## 三宿主 A/B 对比（最终基准）

评测体系覆盖三种宿主模式，各代表不同的记忆注入路径：

| 宿主 | 记忆注入方式 | 有无工具调用 | 定位 |
|------|------------|:---:|------|
| LLM | `seed_memories` 直接拼入 system prompt | 无 | 理论上限：记忆被完全信任，零探索开销 |
| Claude Code | CLAUDE.md（项目级指令）+ hooks（`memory-bridge.mjs` 平台注入） | 有 | 真实宿主：记忆通过文件权威和运行时管线双通道送达 |
| Codex | stdin 强制注入（`prepare-context` → `codex exec`） | 有 | 真实宿主：记忆通过平台管线送入，不依赖 MCP |

### 100 任务全量结果

| 指标 | LLM（上限） | Claude Code | Codex |
|------|:---:|:---:|:---:|
| `b_win_rate` | **0.75** | 0.64 | 0.57 |
| `retrieval_b_win_rate` | **0.86** | 0.65 | 0.60 |
| `avg_task_success_a` | 3.33 | 2.83 | 3.79 |
| `avg_task_success_b` | **4.49** | 3.38 | 4.13 |
| `avg_memory_usefulness_b` | **2.81** | 2.02 | 1.95 |
| `both_bad` | 0 | 3 | 1 |
| `tool_event_ratio_b_a` | — | 1.09 | **0.83** |

### 分层 gap 解读

```
理想上限（1.0）
  │
  ├── 0.25：记忆内容本身质量上限（LLM 模型能力 + 记忆与任务的匹配度）
  │         LLM b_win_rate = 0.75，说明即使完美注入，记忆也非万能
  │
  └── 0.11–0.18：宿主工具开销
           │
           ├─ Claude Code（gap 0.11）
           │   ├─ 优势：CLAUDE.md 被模型视为项目真理，记忆权威性高
           │   └─ 劣势：工具 B/A = 1.09，记忆未能减少探索
           │
           └─ Codex（gap 0.18）
               ├─ 优势：工具 B/A = 0.83，记忆有效减少了文件探索（省 17%）
               └─ 劣势：全局胜率略低于 Claude，管线送达率（0.02）可优化
```

核心发现：

- **LLM 组没有工具，记忆就是唯一信源** — 模型拿到后直接融入回答。`task_success_b=4.49`，`memory_usefulness=2.81`，是所有路径的上限。

- **有工具的宿主会把记忆当"线索"而非"答案"** — 拿到记忆后第一反应是用工具去文件系统验证，验证过程消耗认知和 token，对记忆有用性产生负向摩擦。Claude 的工具 B/A=1.09 意味着记忆反而增加了工具使用。

- **"自己找到的东西比被告知的东西更可信"** — 这是 LLM agent 的固有行为模式，由 Claude Code / Codex 系统级 prompt 决定，不受评测框架控制。这也是为什么真实宿主永远无法追平 LLM 组。

- **Claude 和 Codex 各赢一半** — Claude 依托 CLAUDE.md 的权威地位在胜率上领先；Codex 在裸回答质量（A 组 3.79 vs 2.83）和工具效率（0.83 vs 1.09）上更优。

### 优化历程

| 轮次 | 改动 | Claude b_win_rate | Codex b_win_rate |
|------|------|:---:|:---:|
| 1 | 空目录 + 原始注入 | 0.36 | — |
| 2 | 骨架项目 + CLAUDE.md/AGENTS.md 权威记忆 | 0.43 | — |
| 3 | 记忆语态从"告知事实"改为"文件路径+执行命令" | 0.62 | — |
| 4 | `--seed` 打通 storage → read model 管线 | 0.64 | — |
| 5 | 放弃 MCP，改为 stdin 强制注入 | — | 0.46 |
| 6 | `--seed` + 强制注入结合 | — | **0.57** |

关键结论：评测环境必须明确管控"信源唯一性"——如果任务信息同时存在于骨架文件和注入记忆中，模型会优先信任自己发现的文件内容，记忆评测的精度就会退化。三种宿主的路径应始终保持互不污染。

## 主要指标

- `b_win_rate`：开启记忆的 B 组胜率
- `avg_task_success_a/b`：A/B 平均任务完成度
- `avg_memory_usefulness_b`：B 组记忆有用度
- `memory_misuse_rate_b`：B 组误用记忆率
- `irrelevant_noise_rate_b`：无关问题中 B 组强行提记忆的比例
- `omission_rate_b`：应该用记忆但 B 组遗漏的比例
- `runtime_trace_rate`：真实宿主 B 组在 runtime 中能查到轨迹的比例
- `platform_delivery_rate`：Codex B 组平台已把上下文交付到宿主输入的比例
- `platform_memory_delivery_rate`：Codex B 组平台交付上下文中包含记忆记录的比例
- `avg_tool_events_a/b`：A/B 组平均工具事件数（代理工具调用强度）
- `tool_event_ratio_b_a`：B/A 工具事件比（<1 表示记忆减少了工具探索，>1 表示记忆反而增加了探索）
- `writeback_trigger_rate`：B 组结束回合后触发写回的比例

## 注意

如果目标是最终验收，请优先使用真实宿主模式。轻量模式只用于快速调试任务集、评审 prompt 和指标汇总。

Codex 的“是否获得记忆”只按平台事实判断：平台调用 `prepare-context`，生成上下文，并交付到 Codex 输入。Codex 输出不再作为注入送达证明，只用于评价回答质量。
