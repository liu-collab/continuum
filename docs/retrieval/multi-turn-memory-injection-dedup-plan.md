# 多轮会话记忆重复注入治理方案

## 当前结论

当前链路已经能稳定完成：

- `session_start`（会话启动）恢复
- `prepare-context`（轮前准备）检索与注入
- `finalize-turn`（轮后结束）写回检查

但在多轮会话里，仍然存在一个明显问题：

- 同一条记忆在上一轮已经注入过
- 下一轮如果再次触发召回
- 这条记忆仍然可能再次进入 prompt（提示词）

当前实现只处理了：

- 单轮内多 phase（阶段）结果合并时按 `record.id` 去重

当前没有处理：

- 跨轮重复注入
- 稳定记忆和增量记忆分层
- 会话常驻记忆的失效与刷新
- 按 `memory_type`（记忆类型）区分重复注入策略

这份文档的目标，就是把这部分收成一套可落地方案。

---

## 1. 这份方案解决什么问题

这里解决的是“多轮会话里的重复注入”。

更具体地说，是下面四类问题：

### 1.1 稳定偏好被每轮重复带入

例如：

- “默认中文输出”
- “回答简短直接”
- “修改前先对齐现有实现”

这类 `fact_preference`（偏好/事实）通常是稳定信息，不应该在每一轮都重新作为“新注入”出现。

### 1.2 短时任务状态被连续重放

例如：

- “当前正在排查记忆注入链路”
- “当前任务是支付链路重构”

这类 `task_state`（任务状态）在短时间内通常变化不大，如果每轮都重新注入，会挤占上下文预算。

### 1.3 短期事件型记忆重复带来噪声

例如：

- “上一轮已确认要先看 runtime”
- “刚才已经试过一次命令”

这类 `episodic`（事件型）记忆在连续多轮中反复出现，收益通常很低。

### 1.4 写回后常驻段可能继续携带旧版本

例如用户在中途明确改口：

- “算了，还是用 tab”

如果前面常驻的是：

- “统一用空格缩进”

那就需要在记忆写回与读模型刷新后，把常驻段更新成新版本，而不是继续把旧版本带进后续轮次。

---

## 2. 先定设计结论

这次不建议只做一个“最近注入过就过滤掉”的补丁。

如果只做纯过滤，会有两个问题：

- 它默认“之前注入过 = 当前模型上下文仍然稳定可见”
- 它没有区分“稳定记忆”和“增量记忆”

因此这次收口成下面四条：

### 2.1 会话记忆分两层

第一层：

- `session resident memory`（会话常驻记忆）

第二层：

- `turn incremental injection`（单轮增量注入）

### 2.2 常驻层只放稳定记忆

主要包括：

- 稳定 `fact_preference`
- 当前仍有效的核心 `task_state`

这些内容在 `session_start`（会话启动）恢复后，进入宿主会话状态，不再依赖每轮重新召回。

### 2.3 轮前注入只补增量

`before_response`（回答前）默认只补：

- 新的 `task_state`
- 短期仍有价值的 `episodic`
- 当前问题强相关、但常驻层里没有的稳定记忆

### 2.4 跨轮防重复采用“硬去重 + 软去重 + 破窗重放”

也就是：

- 短窗内直接过滤
- 中窗内交给注入规划层决定
- 特定条件下允许重新注入

这是这次方案的总原则。

---

## 3. 最终方案概览

## 3.1 总体结构

最终链路按下面方式运行：

1. `session_start`
2. runtime 召回稳定记忆
3. 宿主保存为 `resident memory`（常驻记忆）
4. 后续每轮 `prepare-context`
5. runtime 只返回增量候选
6. runtime 根据近期注入历史做跨轮去重
7. 宿主把“常驻记忆 + 本轮增量”一起放入 prompt
8. `finalize-turn`
9. 写回提交后把常驻状态标记为 `dirty`（待刷新）
10. 读模型刷新后，宿主重新拉取常驻记忆快照

### 3.2 策略核心

本方案不是单点改造，而是三件事一起做：

- 分层：常驻与增量分开
- 去重：跨轮短窗去重
- 刷新：常驻段支持失效与更新

---

## 4. 方案细化

## 4.1 常驻记忆层

### 4.1.1 定义

常驻记忆是一个宿主会话级状态。

它不表示“这条记忆永远有效”，而表示：

- 在当前 session（会话）里
- 这条记忆应该持续对后续多轮可见
- 不需要每轮都走一次新的召回与注入决策

### 4.1.2 适合进入常驻层的内容

首版建议只允许下面两类：

- 稳定 `fact_preference`
- 核心 `task_state`

其中：

- `fact_preference` 更偏长期偏好和稳定约束
- `task_state` 更偏当前 session 中仍有效的任务上下文

### 4.1.3 不进入常驻层的内容

首版默认不进入常驻层：

- `episodic`
- 临时性说明
- 只对当前一轮有价值的高语义相似结果

### 4.1.4 常驻层的来源

首版统一来自：

- `session_start-context`

后续可以补：

- `task_switch` 后的局部刷新
- 用户显式请求“重新同步上下文”时的手动刷新

### 4.1.5 常驻层的宿主职责

常驻层建议放在宿主侧维护。

这里的宿主包括：

- `memory-native-agent`
- `Codex` 适配器
- `Claude` 适配器

原因是：

- prompt 最终组装发生在宿主
- 宿主最清楚当前 session 实际带了哪些内容
- 这样可以避免 runtime 每轮都重复返回同一批稳定内容

---

## 4.2 单轮增量注入层

### 4.2.1 定义

增量注入表示：

- 当前这轮新需要补充的记忆
- 它不应该默认长期常驻
- 它需要接受跨轮去重和预算控制

### 4.2.2 主要来源

主要来自：

- `before_response`
- `task_start`
- `task_switch`
- `before_plan`

### 4.2.3 默认只补哪些内容

首版建议：

- 新的 `task_state`
- 和当前问题直接相关的 `episodic`
- 当前轮强相关但常驻层里没有的 `fact_preference`

### 4.2.4 为什么要分开

因为常驻层和增量层本来语义就不同：

- 常驻层解决“稳定上下文”
- 增量层解决“当前轮补充”

如果不拆开，就只能一直靠“本轮查出来什么就塞什么”，这也是重复注入问题的根因之一。

---

## 4.3 跨轮去重策略

## 4.3.1 总体策略

跨轮去重不采用单一规则，而采用三段式：

- `hard window`（硬去重窗口）
- `soft window`（软去重窗口）
- `replay escape`（破窗重放）

### 4.3.2 硬去重窗口

规则：

- 在同一 `session_id + record_id` 维度下
- 如果一条记忆刚在短时间内注入过
- 则下一轮直接过滤，不再给注入规划层

硬去重窗口的目标是解决：

- 短时间无脑重复
- 同主题连续追问时的上下文污染

### 4.3.3 软去重窗口

规则：

- 超过硬去重窗口
- 但仍在较长的软窗口内
- 这时不直接过滤
- 而是标记为 `recently_injected=true`
- 让注入规划层决定要不要再次注入

软去重窗口的目标是解决：

- 上下文发生变化，但不确定是否值得重放
- 需要模型根据当前问题语义判断

### 4.3.4 破窗重放

即使命中了硬去重或软去重，也允许在特定条件下打破限制，重新注入。

首版允许的破窗条件：

- `task_switch`
- `session_start` 之后首次关键轮
- 记录版本发生变化
- 用户显式引用历史
- 常驻层被标脏并刚完成刷新
- 常驻记忆因预算裁剪未实际进入 prompt

---

## 4.4 按记忆类型区分窗口

不同 `memory_type` 不应该共用一个窗口。

首版建议如下：

### `fact_preference`

- 不作为普通增量频繁注入
- 优先走常驻层
- 若确实进入增量层，硬窗口建议较长
- 可以接近整个 session 生命周期

### `task_state`

- 允许阶段性重放
- 硬窗口建议中等
- 建议按轮数和时间双重控制

### `episodic`

- 变化快，价值短
- 硬窗口建议最短
- 超过短窗口后即可重新参与召回

可以先给一组默认值：

| 类型 | 常驻策略 | 硬窗口 | 软窗口 |
| --- | --- | --- | --- |
| `fact_preference` | 优先常驻 | 当前 session 或 30 分钟 | 可选，默认关闭 |
| `task_state` | 仅核心状态常驻 | 3-5 轮或 10 分钟 | 30 分钟 |
| `episodic` | 不常驻 | 2 轮或 5 分钟 | 15 分钟 |

这里的具体数值不在首版写死，要做成配置项。

---

## 4.5 显式历史提问检测

这里不要只复用一个宽泛的 `needs_memory`（需要记忆）信号。

原因是：

- `needs_memory=true` 只能说明“当前轮应该查记忆”
- 不能说明“应该打破去重，重新注入最近已经注入过的记忆”

因此这里要区分两个概念：

### 4.5.1 是否需要查记忆

可以继续复用现有：

- `intent-analyzer`
- `history_reference` 关键词触发
- `llm recall judge`

### 4.5.2 是否允许重放近期已注入记忆

建议单独输出一个更窄的信号，例如：

- `allow_recent_replay`

首版可以先按下面口径实现：

- 命中现有 `history_reference`（历史引用）触发时，视为 `allow_recent_replay=true`
- 后续再由 `intent-analyzer` 输出正式字段

这样可以先复用现有触发器，不需要一开始就打穿太多模块。

---

## 4.6 常驻记忆的失效与刷新

这是这次方案里很关键的一部分。

### 4.6.1 问题

如果用户在 session 中途修改了偏好或任务约定：

- 旧常驻记忆不能继续一直带着

### 4.6.2 不建议的做法

不建议：

- `finalize-turn` 一提交成功
- 宿主就直接把常驻段改掉

原因是当前写回是异步的，中间还会经过：

- storage 去重
- merge（合并）
- conflict（冲突）
- 读模型刷新

所以“提交成功”不等于“最终落库版本已稳定可读”。

### 4.6.3 建议做法

建议采用：

- `dirty + refresh`（标脏后刷新）

具体规则：

1. `finalize-turn` 返回中，只要本轮候选里包含可能影响常驻层的内容
2. 宿主就把当前常驻层标记为 `dirty`
3. 后续在下一个安全时机重新拉一次常驻快照
4. 以读模型中最新有效版本替换宿主常驻层

### 4.6.4 哪些写回会触发常驻层标脏

首版建议：

- `fact_preference`
- 被识别为核心状态的 `task_state`

### 4.6.5 刷新时机

首版建议下面两个时机择一：

- 下一轮开始前，如果发现 `resident_memory_dirty=true`
- 或在 `finalize-turn` 之后异步等待一小段时间再刷新

优先推荐第一种：

- 简单
- 不依赖额外回调
- 更容易保证读模型已经完成刷新

---

## 5. 去重逻辑放在哪里

## 5.1 常驻层逻辑放宿主

包括：

- 常驻快照保存
- 常驻层标脏
- 常驻层刷新
- prompt 中常驻段组装

理由：

- 宿主掌握最终 prompt
- 常驻层本身是会话内状态
- 不需要每轮都从 runtime 重复返回

## 5.2 增量层防重复主逻辑放 runtime

包括：

- 近期注入历史记录
- 硬窗口过滤
- 软窗口标记
- 破窗条件判断

理由：

- 这一层属于记忆召回与注入决策
- 放在 runtime 可以对所有宿主统一生效
- 可观测和回归测试都更集中

## 5.3 为什么不把全部逻辑都放宿主

如果全部放宿主，会带来三个问题：

- `MNA`、`Codex`、`Claude` 三套逻辑容易漂移
- runtime 观测不到真实过滤原因
- 后续注入规划层拿不到统一的“近期已注入”信息

所以这里的边界建议是：

- 宿主管常驻
- runtime 管增量防重

---

## 6. 数据结构与状态建议

## 6.1 runtime 内部新增近期注入状态

建议新增一个会话级缓存：

```ts
type RecentInjectionState = Map<
  string,
  Map<
    string,
    {
      record_id: string;
      memory_type: "fact_preference" | "task_state" | "episodic";
      injected_at: number;
      turn_index: number;
      trace_id?: string;
      source_phase: string;
      resident_source?: boolean;
    }
  >
>;
```

第一层 key：

- `session_id`

第二层 key：

- `record_id`

### 6.1.1 为什么不用只存 `Set`

因为后面需要判断：

- 距离上次注入过了多久
- 跨了多少轮
- 它属于哪种 `memory_type`
- 是常驻层还是增量层产生的

所以只存 `Set<recordId>` 不够。

---

## 6.2 runtime 传给注入规划层的附加字段

如果进入软窗口，建议把下面信息带给注入规划层：

```ts
type RecentInjectionHint = {
  record_id: string;
  recently_injected: boolean;
  injected_at: string;
  turns_since_last_injection: number;
};
```

对应候选侧可以加：

- `recent_injection_hint`

这样规划层能更稳定地做“要不要重注入”的判断。

---

## 6.3 宿主侧新增常驻记忆状态

建议在宿主 session 状态里新增：

```ts
type ResidentMemoryState = {
  records: Array<{
    id: string;
    memory_type: string;
    scope: string;
    summary: string;
    importance: number;
    confidence: number;
    source_trace_id?: string;
  }>;
  snapshot_at: string;
  dirty: boolean;
  dirty_reason?: string;
};
```

---

## 7. 主链路改造

## 7.1 `session_start` 链路

当前：

- 返回 `additional_context`
- 返回 `injection_block`

建议改成：

- runtime 继续返回结构化 `injection_block`
- 宿主把其中符合常驻规则的内容存成 `resident memory`
- 宿主在后续每轮 prompt 中持续携带常驻段

这里不要求首版改 API 契约，只需要：

- 宿主侧增加一层常驻抽取逻辑

---

## 7.2 `prepare-context` 链路

建议拆成三步：

1. 先召回候选
2. 再按近期注入历史做窗口判断
3. 最后再进入注入规划与裁剪

### 7.2.1 硬窗口处理

直接过滤，不给规划层看。

### 7.2.2 软窗口处理

保留候选，但带上“近期注入过”的提示。

### 7.2.3 破窗重放处理

如果命中破窗条件，则跳过上面窗口约束。

---

## 7.3 `finalize-turn` 链路

这里不直接改写常驻段。

这里做两件事：

1. 如果本轮最终确实有注入发生，更新近期注入状态
2. 如果本轮写回候选可能影响常驻层，标记宿主常驻层为 `dirty`

---

## 8. 配置项设计

建议新增下面几组配置。

## 8.1 runtime 侧

### 基础开关

- `INJECTION_DEDUP_ENABLED=true`

### 轮数窗口

- `INJECTION_HARD_WINDOW_TURNS_FACT_PREFERENCE`
- `INJECTION_HARD_WINDOW_TURNS_TASK_STATE`
- `INJECTION_HARD_WINDOW_TURNS_EPISODIC`

### 时间窗口

- `INJECTION_HARD_WINDOW_MS_FACT_PREFERENCE`
- `INJECTION_HARD_WINDOW_MS_TASK_STATE`
- `INJECTION_HARD_WINDOW_MS_EPISODIC`
- `INJECTION_SOFT_WINDOW_MS_TASK_STATE`
- `INJECTION_SOFT_WINDOW_MS_EPISODIC`

### 缓存清理

- `INJECTION_RECENT_STATE_TTL_MS`
- `INJECTION_RECENT_STATE_MAX_SESSIONS`

## 8.2 宿主侧

- `RESIDENT_MEMORY_ENABLED=true`
- `RESIDENT_MEMORY_REFRESH_ON_DIRTY=true`
- `RESIDENT_MEMORY_MAX_RECORDS`

首版可以先从保守默认值开始，不建议一次把可调项开得太多。

---

## 9. 可观测要求

这次方案如果没有观测，很快就会变成黑盒。

至少要补下面几类信息。

## 9.1 runtime 运行轨迹

在 `recall`（召回）和 `injection`（注入）阶段补充：

- `recently_filtered_record_ids`
- `recently_filtered_reasons`
- `recently_soft_marked_record_ids`
- `replay_escape_reason`

### 典型 reason

- `hard_window_active`
- `soft_window_active`
- `history_reference_escape`
- `task_switch_escape`
- `record_version_changed_escape`

## 9.2 宿主状态

宿主侧需要能看到：

- 当前常驻记忆条数
- 当前常驻快照时间
- 当前是否 `dirty`
- 本轮实际进入 prompt 的常驻条数
- 本轮实际进入 prompt 的增量条数

## 9.3 指标

建议新增：

- 多轮重复注入压降率
- 破窗重放命中率
- 常驻层刷新次数
- 常驻层刷新后版本替换次数

---

## 10. 分阶段实施建议

## 第一阶段：先补跨轮硬去重

范围：

- [x] runtime 增加近期注入缓存
- [x] `before_response` 在注入规划前做硬窗口过滤
- [x] 轨迹里补过滤原因
- [x] 按 `memory_type` 区分硬窗口默认值
- [x] 为硬去重补单元测试与回归测试

这一阶段不改 API 契约，不改宿主常驻层。

目标：

- 先把最明显的短时重复打掉

## 第二阶段：补宿主常驻层

范围：

- [x] 宿主保存 `session_start` 稳定记忆
- [x] prompt 组装时把常驻段和增量段分开
- [x] 补 `dirty + refresh`
- [x] 为常驻层与刷新链路补测试

目标：

- 让稳定偏好和核心任务状态不再依赖每轮重复召回

## 第三阶段：补软窗口与破窗重放

范围：

- [x] 软窗口提示字段
- [x] `history_reference` 破窗逻辑
- [ ] 任务切换和版本变化破窗
- [x] 为软窗口和 `history_reference` 破窗补测试

目标：

- 在“防重复”之外保留必要灵活性

## 第四阶段：调参与效果评估

范围：

- [x] 区分 `memory_type` 的默认窗口
- [ ] 根据运行轨迹调阈值
- [ ] 验证回答质量是否受影响

---

## 11. 测试要求

首版至少补下面几组测试。

## 11.1 runtime 单元测试

- 同一 session 连续两轮相同候选，第二轮被硬窗口过滤
- 不同 `memory_type` 使用不同窗口
- 命中 `history_reference` 时允许破窗
- 软窗口命中时候选仍保留，但带标记

## 11.2 宿主侧测试

- `session_start` 后常驻段被保存
- 后续多轮即使 runtime 不再返回相同稳定记忆，prompt 中仍能看到常驻段
- 写回后常驻层被标脏
- 下一轮开始前完成常驻刷新并替换旧内容

## 11.3 端到端测试

- 用户先声明偏好，再连续追问三轮，不应每轮重复注入同一偏好
- 用户中途显式改口后，旧偏好在刷新后应从常驻层移除
- `task_switch` 后允许必要记忆重新注入

---

## 12. 风险与边界

### 12.1 过滤过严会丢信息

如果窗口过长，可能导致：

- 该重放时没有重放

所以首版参数要保守，先短窗，再逐步加长。

### 12.2 常驻层和实际 prompt 可能漂移

如果宿主只保存常驻快照，但不知道它有没有真正进入 prompt，就会出现：

- 系统以为“已经带了”
- 实际被预算裁掉了

所以要记录：

- 常驻层存在
- 常驻层实际进入 prompt

这两个状态不能混为一谈。

### 12.3 异步写回与读模型刷新存在时间差

所以常驻层更新必须走：

- 标脏
- 刷新

而不是“提交成功就直接替换”。

---

## 13. 最终收口

这次方案最终收成下面一句话：

`session_start`（会话启动）负责稳定记忆常驻，`before_response`（回答前）负责增量补充，跨轮重复注入由 runtime 按记忆类型窗口控制，常驻内容通过 `dirty + refresh`（标脏刷新）保持最新。

对应实施顺序是：

1. 先做 runtime 短窗硬去重
2. 再做宿主常驻层
3. 再补软窗口和破窗重放
4. 最后做调参与效果验证

这版方案的重点不是“完全禁止重复”，而是：

- 避免无意义重复
- 保留必要重放
- 让稳定上下文和当前轮补充分层清晰
