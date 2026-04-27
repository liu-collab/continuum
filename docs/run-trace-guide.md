---
title: 运行轨迹说明
description: 运行页字段、阶段含义、筛选方式、空状态和常见排查路径。
category: overview
order: 30
slug: run-trace
---

# 运行轨迹说明

## 1. 页面用途

运行轨迹页用于查看单轮请求在 `retrieval-runtime` 中经历了哪些阶段。

它主要回答四个问题：

- 这一轮是否触发了记忆召回
- 实际查询了哪些 scope
- 最后是否注入了记忆
- 回合结束后是否提交了写回

## 2. 筛选方式

当前正式支持三类筛选：

| 筛选项 | 说明 |
|---|---|
| `turn_id` | 按宿主侧单轮 ID 查询 |
| `session_id` | 按会话 ID 查询最近轨迹 |
| `trace_id` | 按运行时轨迹 ID 精确查询 |

最近运行列表里的卡片会使用 `trace_id` 打开详情，避免同一轮多阶段记录被拆开查看。

## 3. 阶段含义

| 阶段 | 说明 |
|---|---|
| `session_start` | 会话启动时的轻量上下文准备 |
| `task_start` | 新任务开始时的触发与召回判断 |
| `task_switch` | 任务切换时重新判断上下文 |
| `before_plan` | 规划前准备可用记忆 |
| `before_response` | 回复前准备最终注入内容 |
| `after_response` | 回复后生成和提交写回候选 |

页面会按阶段聚合 `turn`、`trigger`、`recall`、`injection`、`memory plan` 和 `writeback` 记录。

## 4. 字段说明

### 4.1 Turn

`Turn` 区域展示当前轨迹的基本身份信息，包括 `trace_id`、`turn_id`、`phase`、`host`、`session`、`workspace`、`task` 和 `thread`。

### 4.2 阶段卡片

阶段卡片展示这一阶段的触发、召回、注入和写回摘要。

常见状态包括：

- `completed`：阶段正常完成
- `empty`：已执行但没有命中可用记忆
- `injected`：已有记忆注入
- `submitted`：写回候选已提交
- `degraded`：依赖异常或超时后降级

### 4.3 依赖快照

依赖快照展示运行时依赖在该轨迹附近的状态，用来判断空结果或降级是否由外部服务导致。

## 5. 空状态

页面可能出现三类空状态：

| 状态 | 含义 |
|---|---|
| 未输入筛选 | 可以先从最近运行列表选择一条轨迹 |
| 筛选无结果 | 上游可访问，但没有对应 `turn_id` 或 `trace_id` |
| 数据源不可用 | `retrieval-runtime` 观测接口暂时不可查询 |

## 6. 排查顺序

建议按这个顺序看：

1. 先确认 `trace_id` 是否和当前轮一致。
2. 再看触发阶段是否命中。
3. 如果触发了但没有注入，检查召回数量和作用域。
4. 如果写回为空，检查 `after_response` 阶段和依赖快照。
5. 如果页面提示数据源不可用，先检查 runtime 服务和环境配置。
