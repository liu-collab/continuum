# MNA 扩展需求实施细化

> 基于 `mna-extension-requirements-assessment.md` 的判断结果，把 7 项扩展需求进一步拆成可执行事项和落地方案。
>
> 这份文档重点回答：
> 1. 每一项到底要补哪些能力
> 2. 推荐怎样落地，改哪些层
> 3. 应该按什么顺序做
> 4. 做到什么程度算完成

---

## 目录

- [一、实施原则](#一实施原则)
- [二、阶段建议](#二阶段建议)
- [三、逐项实施细化](#三逐项实施细化)
  - [1. 上下文窗口管理深化](#1-上下文窗口管理深化)
  - [2. 规划与任务分解](#2-规划与任务分解)
  - [3. 自我评估与纠错](#3-自我评估与纠错)
  - [4. 工具执行并行化](#4-工具执行并行化)
  - [5. 沙箱](#5-沙箱)
  - [6. 缓存层](#6-缓存层)
  - [7. 可观测性标准化](#7-可观测性标准化)
- [四、建议的交付顺序](#四建议的交付顺序)

---

## 一、实施原则

这 7 项不要一起平铺推进，原因很简单：

- 有些是把现有能力做深，比如上下文窗口管理
- 有些是全新能力，比如计划器、缓存层
- 有些是跨切面能力，比如沙箱和可观测性

更稳妥的做法是：

1. 先补主链路里最容易失控的点
2. 再补复杂任务执行能力
3. 最后补运维、性能和成本侧能力

落地时建议坚持三个约束：

- 不一次性推翻现有 `AgentRunner`
- 尽量先补可测试的纯函数和清晰接口，再改主循环
- 每一项都先做 `MVP`（最小可用版），跑通后再继续抽象

---

## 二、阶段建议

### Phase 1：先补主链路风险

- 上下文窗口管理深化
- 工具执行并行化
- 沙箱第一阶段

### Phase 2：补复杂任务处理能力

- 规划与任务分解
- 自我评估与纠错

### Phase 3：补生产化能力

- 可观测性标准化
- 缓存层

这样排的原因是：

- `上下文`、`并行`、`沙箱` 直接影响稳定性和安全边界
- `规划` 和 `纠错` 决定复杂任务能不能跑稳
- `观测` 和 `缓存` 更适合在主链路相对稳定后做

---

## 三、逐项实施细化

## 1. 上下文窗口管理深化

### 目标

把现在已有的 `token budget`（token 预算）升级成真正的上下文编排能力，重点解决：

- 不同内容类型之间没有显式预算
- 工具结果和会话预算没有统一调度
- 历史裁剪仍偏粗粒度

### 需要做的事

1. 增加显式预算分区
2. 给消息和片段增加优先级与成本模型
3. 统一工具输出预算和会话预算
4. 增加更稳定的历史压缩策略
5. 暴露调试信息，让前端能看到“为什么这轮裁掉了哪些内容”

### 建议方案

#### 1.1 引入 `ContextBudgetPlanner`（上下文预算规划器）

职责：

- 读取 `system prompt`、记忆注入、工具定义、历史消息、当前输入
- 先做 token estimate
- 再按预算区间选择保留内容
- 输出“最终消息 + 被丢弃原因 + 预算分布结果”

建议输出形态：

```ts
interface ContextBudgetPlan {
  budget: {
    total: number;
    reserve: number;
    available_for_prompt: number;
  };
  allocation: {
    fixed: number;
    memory: number;
    tools: number;
    history: number;
    current_turn: number;
  };
  kept: ChatMessage[];
  dropped: Array<{
    source: "history" | "memory" | "tool_output";
    reason: "budget" | "priority" | "duplicate" | "oversize";
    preview: string;
  }>;
}
```

#### 1.2 预算比例先做成配置常量，不一开始做动态学习

第一阶段建议固定成几段预算：

- `fixed`：system prompt + 必需协议片段
- `memory`：记忆注入
- `tools`：工具定义与最近工具输出
- `history`：历史消息
- `current_turn`：当前轮用户输入和必要上下文

建议先做规则分配，例如：

- `fixed` 永远保留
- `current_turn` 永远保留
- `memory_high` 高于 `history`
- `tool output` 高于旧的 `assistant text`

#### 1.3 历史压缩先做规则摘要，不直接引入额外 LLM 成本

第一阶段建议：

- 继续保留 `truncate`（截断）
- 把现有 `archivedSummary` 升级成结构化摘要
- 摘要里保留最近主题、关键工具调用、关键失败信息

第二阶段再考虑：

- 引入可选的 `llm summarize`（模型摘要）模式

#### 1.4 工具输出预算统一接入 planner

现在工具输出已经能落 `artifact`，下一步要做的是：

- 在写入 `conversation` 前就拿到输出预算
- 对超预算工具结果只保留：
  - 状态
  - 摘要
  - `artifact_ref`
  - 必要错误信息

#### 1.5 增加调试视图

建议在 `dispatched_messages` 或运行时事件里补：

- 本轮预算上限
- 各区实际占用
- 被裁剪内容数量
- 最近一次压缩原因

### 推荐改动范围

- 新增：`src/runner/context-budget-planner.ts`
- 修改：`src/runner/conversation.ts`
- 修改：`src/runner/token-budget.ts`
- 修改：`src/runner/agent-runner.ts`
- 修改：`src/tools/helpers.ts`
- 修改：`src/session-store/sqlite-store.ts`
- 修改：调试接口和前端展示

### 分阶段落地

#### 第一阶段

- 抽出 planner
- 固定预算分区
- 统一工具输出裁剪入口
- 增强调试信息

#### 第二阶段

- 增加规则型历史摘要
- 增加更精细的消息优先级

#### 第三阶段

- 接入精确 tokenizer
- 可选 LLM 历史压缩

### 完成标准

- 长会话下不再出现“消息无限增长后直接超窗”的情况
- 调试面板能看出本轮预算如何分配
- 工具长输出不会再把历史区快速挤满
- 有覆盖长会话、超长工具输出、极小 budget 的测试

---

## 2. 规划与任务分解

### 目标

让 MNA 在复杂任务里不再只是“边想边反应”，而是能形成可跟踪的计划。

### 需要做的事

1. 定义计划数据结构
2. 增加计划生成阶段
3. 增加计划状态跟踪
4. 支持执行中修订计划
5. 让前端和调试接口能看到计划

### 建议方案

#### 2.1 引入轻量计划模型，不先做复杂工作流引擎

建议先定义：

```ts
interface ExecutionPlan {
  id: string;
  session_id: string;
  turn_id: string;
  goal: string;
  status: "draft" | "approved" | "running" | "completed" | "revised" | "abandoned";
  steps: PlanStep[];
  created_at: string;
  updated_at: string;
}

interface PlanStep {
  id: string;
  title: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  notes?: string;
}
```

第一阶段不要求计划绝对准确，先解决“有无”和“能不能跟踪”。

#### 2.2 计划生成分成两类触发

- 显式触发：用户说“先规划”“给个方案”“一步一步来”
- 隐式触发：检测到任务复杂度较高，例如：
  - 包含多个目标
  - 明显需要读写多文件
  - 包含迁移、重构、修复链式任务

#### 2.3 先做“计划生成 + 自动继续执行”模式

不建议一开始就把所有计划都改成必须人工确认。

推荐先支持两种模式：

- `plan_mode = advisory`：先生成计划，再继续执行
- `plan_mode = confirm`：先生成计划，等用户确认后再执行

这样可以兼顾现有交互节奏。

#### 2.4 计划状态由 runner 驱动，不交给模型自由维护

模型只负责给出候选步骤；
真正的状态推进由系统维护：

- 开始执行某步时标记 `in_progress`
- 工具和输出达到条件后标记 `completed`
- 失败时标记 `failed`

#### 2.5 计划修订走“局部重写”

执行中发现问题时，不要整份重建。

先支持：

- 保留已完成步骤
- 改写未完成步骤
- 记录修订原因

### 推荐改动范围

- 新增：`src/planning/types.ts`
- 新增：`src/planning/plan-generator.ts`
- 新增：`src/planning/plan-state.ts`
- 修改：`src/runner/agent-runner.ts`
- 修改：`src/runner/trigger-detector.ts`
- 修改：`src/session-store` 增加计划表
- 修改：前端事件与调试接口

### 分阶段落地

#### 第一阶段

- 定义计划模型
- 在 `before_plan` 后生成计划
- 将计划通过事件发给前端

#### 第二阶段

- 增加步骤状态跟踪
- 执行中自动更新当前步骤

#### 第三阶段

- 支持计划修订
- 增加显式确认模式

### 完成标准

- 复杂任务能够形成结构化计划
- 前端能看到当前计划和步骤状态
- runner 能知道自己当前在做哪一步
- 计划变更有记录，不是每轮凭空重来

---

## 3. 自我评估与纠错

### 目标

把当前“失败就继续往下走”的反应式链路，补成带验收、重试、降级的闭环。

### 需要做的事

1. 定义执行后检查点
2. 定义错误分类与对应策略
3. 增加最大重试与防循环机制
4. 增加反思或改写策略
5. 让调试链路能看到失败原因和重试过程

### 建议方案

#### 3.1 引入 `TurnEvaluator`（回合评估器）

职责：

- 在工具调用后判断结果是否可接受
- 在最终回答前判断是否满足最低交付要求
- 决定：通过、重试、降级、需要用户澄清

建议输出：

```ts
interface EvaluationDecision {
  status: "pass" | "retry" | "revise" | "ask_user" | "stop";
  reason: string;
  retry_strategy?: "same_tool" | "alternative_tool" | "replan" | "narrow_scope";
}
```

#### 3.2 先做规则式检查，不先做模型裁判

优先做这几类硬规则：

- 工具返回 `ok=false`
- 文件写入后预期内容不存在
- 读取结果为空但任务要求必须找到目标
- assistant 输出为空或只重复工具错误
- 连续两轮调用同一工具且参数相同但仍失败

#### 3.3 定义重试矩阵

不同错误类型用不同策略：

- `timeout`：缩小范围后重试一次
- `permission denied`：转为向用户确认
- `tool_not_found`：改走替代工具或直接解释
- `parse/format`：重发更严格指令
- `provider unavailable`：等待后重试或降级

#### 3.4 增加 turn 级上限

至少限制：

- 同一 turn 最多重试次数
- 同一工具同一参数最多尝试次数
- 连续失败达到阈值后必须停下并说明原因

#### 3.5 反思先做轻量版

不要一开始加一个完整 `reflection loop`（反思循环）模型调用。

建议先做：

- 系统侧归纳失败原因
- 如果命中已知模式，则切换策略
- 只有在复杂场景才进入“重新规划”

### 推荐改动范围

- 新增：`src/evaluation/turn-evaluator.ts`
- 新增：`src/evaluation/retry-policy.ts`
- 修改：`src/runner/agent-runner.ts`
- 修改：`src/tools/dispatcher.ts`
- 修改：事件和调试存储

### 分阶段落地

#### 第一阶段

- 错误分类
- 重试上限
- 规则式验收

#### 第二阶段

- 基于错误类型切换策略
- 记录每次重试和原因

#### 第三阶段

- 与计划器联动，失败后触发 `replan`
- 可选引入模型辅助反思

### 完成标准

- 相同失败不会在一个 turn 里无限循环
- 常见失败场景有明确重试或退出策略
- 调试接口能看到每次重试的原因和结果
- 复杂任务失败时，系统能更早停下来说明问题

---

## 4. 工具执行并行化

### 目标

让同一轮里的独立工具调用可以并发执行，减少串行等待时间。

### 需要做的事

1. 收集同轮所有工具调用
2. 判断哪些工具能并发
3. 并行执行并保序回写
4. 正确处理部分失败和取消
5. 增加并行执行的调试指标

### 建议方案

#### 4.1 把当前“边收边执行”改成“先收齐再执行”

推荐在 provider 返回 `finish_reason = tool_use` 后：

- 拿到当前轮全部 `tool_calls`
- 构造执行批次
- 对可并发工具走 `Promise.allSettled()`

#### 4.2 增加工具并发策略声明

不是所有工具都适合并行。

建议给工具元数据增加：

```ts
parallelism?: "safe" | "workspace_mutating" | "exclusive";
```

推荐规则：

- `fs_read`、部分 `mcp_call`：`safe`
- `fs_write`、`fs_edit`：`workspace_mutating`
- `shell_exec`：默认 `exclusive`

第一阶段只并发 `safe` 类工具。

#### 4.3 结果写回必须保序

虽然执行可以并发，但写回对话时仍应按原 `tool_call` 顺序回写，保证：

- `tool_call_id` 对得上
- replay 更稳定
- provider 二次续跑时上下文顺序可预测

#### 4.4 部分失败处理

建议：

- 用 `allSettled` 而不是 `all`
- 某个工具失败，不影响同批其他工具完成
- 失败结果照样写回，并让后续评估器决定是否继续

### 推荐改动范围

- 修改：`src/runner/agent-runner.ts`
- 修改：`src/tools/types.ts`
- 修改：`src/tools/registry.ts` 或内置工具定义
- 修改：metrics 和调试事件

### 分阶段落地

#### 第一阶段

- 同轮收集所有工具调用
- `safe` 工具并发执行
- 保序写回

#### 第二阶段

- 增加简单冲突检测
- 支持同批次部分工具串行、部分工具并发

### 完成标准

- 多个 `fs_read` / 搜索类工具能并发执行
- 写回顺序稳定
- abort 和超时场景不会泄露未回收任务
- 有覆盖多工具并发、部分失败、取消场景的测试

---

## 5. 沙箱

### 目标

把当前的“用户确认 + deny pattern”升级成真正的受控执行环境。

### 需要做的事

1. 定义沙箱抽象层
2. 区分宿主执行和沙箱执行
3. 增加资源限制
4. 增加工作区快照与回滚能力
5. 让高风险工具默认走受限执行

### 建议方案

#### 5.1 不要直接把 `shell_exec` 写死到某个沙箱实现

建议先抽象：

```ts
interface CommandExecutor {
  run(input: CommandExecutionInput): Promise<CommandExecutionResult>;
}
```

然后提供两种实现：

- `HostExecutor`（宿主机执行，兼容现状）
- `SandboxExecutor`（受限执行）

这样后续更容易按平台切换。

#### 5.2 先做“工作区快照 + 超时 + 资源限制”的第一阶段

第一阶段不必上来就追求完整容器化。

建议优先做：

- 执行前记录工作区快照
- 执行后比对文件改动
- 出错时支持回滚受控文件
- 对 shell 进程增加 CPU / 内存 / 时间限制接口

#### 5.3 文件修改类工具也接入回滚轨迹

不只 `shell_exec`，`fs_write` / `fs_edit` 也要统一纳入：

- 修改前备份
- 修改后记录变更摘要
- 回滚时可恢复

#### 5.4 网络权限先做策略层

如果当前阶段还没有合适的底层隔离能力，建议先增加：

- shell 是否允许联网
- 允许哪些域名
- 是否允许新进程派生子进程

即使底层无法完全拦截，也先把策略接口定下来。

### 推荐改动范围

- 新增：`src/sandbox/types.ts`
- 新增：`src/sandbox/executor.ts`
- 新增：`src/sandbox/workspace-snapshot.ts`
- 修改：`src/tools/builtin/shell-exec.ts`
- 修改：`src/tools/builtin/fs-write.ts`
- 修改：`src/tools/builtin/fs-edit.ts`
- 修改：配置与审计记录

### 分阶段落地

#### 第一阶段

- 抽象执行器接口
- 增加工作区快照和回滚
- shell 继续跑宿主机，但纳入统一受控入口

#### 第二阶段

- 增加资源配额
- 高风险命令强制走受限执行器

#### 第三阶段

- 接入平台相关的真正隔离实现
- 完善网络和进程隔离

### 完成标准

- 所有命令执行都走统一执行器
- 文件修改可追踪、可恢复
- 超时和异常退出不会留下不可感知的中间状态
- 高风险操作有清晰审计记录

---

## 6. 缓存层

### 目标

减少重复读取、重复 embedding、重复生成带来的成本和延迟。

### 需要做的事

1. 抽象统一缓存接口
2. 先选明确收益高的热点场景
3. 定义 key、TTL、失效规则
4. 记录缓存命中率和节省成本
5. 避免把缓存引入到有副作用的工具上

### 建议方案

#### 6.1 先做三类缓存

推荐第一阶段只做：

- 文件读取缓存
- embedding 缓存
- 会话级上下文缓存

不建议第一阶段就做：

- shell 输出缓存
- 宽松的 LLM 语义缓存

因为这两类要么副作用风险高，要么命中判定复杂。

#### 6.2 文件读取缓存用“路径 + mtime + 参数”做 key

适合缓存：

- `fs_read`
- 目录列表

key 至少包含：

- workspace_id
- path
- mtime
- `max_lines`
- `byte_limit`

#### 6.3 embedding 缓存用内容哈希

这部分最直接，也最不容易出错。

建议：

- key = `model + content_hash`
- 支持 TTL
- 缓存 miss / hit 记录到 metrics

#### 6.4 会话级上下文缓存先做“准备结果复用”

例如：

- 同一 turn 内重复计算的 token estimate
- 同轮多次使用的 prompt segment 编译结果
- 相同工具定义的 token estimate

这类缓存实现简单，而且不会引入明显一致性问题。

#### 6.5 LLM 响应缓存放到后面

如果后续要做，建议限制在：

- 明显模板化请求
- 无工具调用
- 无外部实时依赖

否则容易出现“命中缓存但语境已变化”的问题。

### 推荐改动范围

- 新增：`src/cache/types.ts`
- 新增：`src/cache/memory-cache.ts`
- 新增：`src/cache/tool-result-cache.ts`
- 新增：`src/cache/embedding-cache.ts`
- 修改：`src/tools/builtin/fs-read.ts`
- 修改：embedding 调用入口
- 修改：runner 内部上下文复用点

### 分阶段落地

#### 第一阶段

- 文件读取缓存
- embedding 缓存
- 会话内小缓存

#### 第二阶段

- 增加缓存失效策略
- 记录命中率和节省 token

#### 第三阶段

- 评估是否需要 LLM 响应缓存

### 完成标准

- 重复 `fs_read` 和 embedding 请求有明显命中
- 缓存命中不会影响正确性
- 可观察到命中率、miss 率、节省的请求数
- 有失效测试，保证文件变化后不会读到旧内容

---

## 7. 可观测性标准化

### 目标

把现在的事件流和 JSON metrics，提升成标准化 trace、metrics、错误归因体系。

### 需要做的事

1. 定义统一 trace / span 模型
2. 把 turn 主链路串起来
3. 增加标准指标导出
4. 建立错误归因字段
5. 补充成本与性能指标

### 建议方案

#### 7.1 先做内部 span 模型，再决定是否直接接 OTel

如果现在直接全面接入 OpenTelemetry，改动面会比较散。

建议先定义内部模型：

```ts
interface RuntimeSpan {
  id: string;
  trace_id: string;
  parent_id?: string;
  name: string;
  kind: "turn" | "memory" | "llm" | "tool" | "writeback";
  started_at: string;
  ended_at?: string;
  status: "ok" | "error" | "cancelled";
  attributes: Record<string, string | number | boolean>;
}
```

内部先串起来，后续再映射到 OTel/OTLP。

#### 7.2 turn 主链路至少覆盖这些 span

- `turn`
- `prepare_context`
- `llm_round`
- `tool_batch`
- `tool_call`
- `finalize_turn`

这样才能真正回答：

- 慢在哪里
- 错在哪一层
- 本轮 token 花在哪一步

#### 7.3 指标导出先补 Prometheus 文本格式

当前已有 JSON metrics，下一步建议：

- 新增 `/metrics`
- 使用 histogram / counter / gauge 的标准形式
- 保留原 JSON 接口用于调试

#### 7.4 错误归因要统一字段

建议每类错误都补充：

- `layer`: `provider | tool | memory | sandbox | runner`
- `code`
- `retriable`
- `turn_id`
- `trace_id`

#### 7.5 增加成本和并行指标

建议增加：

- token 使用量
- 估算成本
- 每轮工具并发数
- 缓存命中率
- 计划生成和修订次数

### 推荐改动范围

- 新增：`src/observability/types.ts`
- 新增：`src/observability/tracer.ts`
- 新增：`src/http/routes/prometheus.ts`
- 修改：`src/http/state.ts`
- 修改：`src/runner/agent-runner.ts`
- 修改：`src/tools/dispatcher.ts`
- 修改：memory / provider 调用入口

### 分阶段落地

#### 第一阶段

- 内部 span 模型
- turn 主链路 tracing
- Prometheus 导出

#### 第二阶段

- 更细的 tool / provider / writeback 指标
- 统一错误归因

#### 第三阶段

- 视需要对接 OTel / OTLP
- 与前端运行轨迹页做更细联动

### 完成标准

- 能从一次 turn 看清完整执行链路
- 能明确判断问题在 memory、provider、tool 还是 runner
- `/metrics` 可被外部采集
- 延迟、token、错误、缓存命中都能被观测

---

## 四、建议的交付顺序

如果只按“工程收益 / 风险比”来排，建议这样推进：

1. `工具执行并行化`
   - 改动边界相对清晰
   - 收益直接
2. `上下文窗口管理深化`
   - 现有基础已经有了
   - 继续做深性价比高
3. `沙箱第一阶段`
   - 先把执行入口和回滚抽象出来
4. `规划与任务分解`
   - 先有计划对象，再有计划执行
5. `自我评估与纠错`
   - 与计划器联动起来效果更好
6. `可观测性标准化`
   - 在主链路相对稳定后补齐
7. `缓存层`
   - 等热点路径更明确后再加，收益更稳定

如果只按“对生产安全影响”来排，则可以改成：

1. `沙箱第一阶段`
2. `上下文窗口管理深化`
3. `工具执行并行化`
4. `规划与任务分解`
5. `自我评估与纠错`
6. `可观测性标准化`
7. `缓存层`

两种排法都合理，区别只在于：

- 前一种更偏工程推进效率
- 后一种更偏生产风险控制

当前仓库更建议采用第二种排序。 
