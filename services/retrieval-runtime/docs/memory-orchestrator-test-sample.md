# 记忆编排器测试样本与验收指标

> 配套文档：`memory-orchestrator-design.md`。  
> 记录时间：2026-04-22。  
> 说明：本文里的“实际指标”分两类记录。  
> 1. 已有自动化测试或类型检查结果的，直接填写当前结果。  
> 2. 需要人工标注、线上采样或产品反馈的，当前明确写为“未采集”。

---

## 1. 使用方式

这份文档主要给三类场景用：

- 测试在做功能验收时，按样本逐条过链路。
- 研发在补指标时，按同一口径回写实际值。
- 产品在看阶段是否可发布时，区分“功能完成”和“效果达标”。

---

## 2. 样本范围

本轮样本覆盖下面 5 类能力：

1. `session_start`（会话开始）主动推荐
2. `before_response`（回答前）意图理解、检索规划、关联召回、注入规划
3. `finalize-turn`（轮次收尾）写回、质量评估、效果反馈
4. `maintenance`（维护任务）关系发现、知识演化、治理执行
5. `visualization`（可视化）plan 级轨迹展示

---

## 3. 功能样本清单

| 编号 | 场景 | 预期结果 | 当前实际 | 证据 |
|---|---|---|---|---|
| S1 | 会话开始时存在可推荐记忆 | 返回 `proactive_recommendations`（主动推荐），并记录 `memory_recommendation_plan` | 已通过 | `services/retrieval-runtime/tests/runtime-service.test.ts` 已覆盖，相关测试通过 |
| S2 | 用户继续上次任务并显式带出偏好 | 触发 `memory_intent_plan + memory_search_plan + memory_injection_plan`，注入偏好与任务状态 | 已通过 | `services/retrieval-runtime/tests/runtime-service.test.ts` 已覆盖，相关测试通过 |
| S3 | 当前任务存在关联记忆 | 基础候选之外补入关联候选，并能进入最终注入 | 已通过 | `services/retrieval-runtime/tests/runtime-service.test.ts` 已覆盖，相关测试通过 |
| S4 | 轮次结束后生成写回候选 | 产生写回候选，经过质量评估后提交，并记录效果反馈 plan | 已通过 | `services/retrieval-runtime/tests/runtime-service.test.ts`、`services/retrieval-runtime/tests/writeback-quality-assessor.test.ts` 已覆盖，相关测试通过 |
| S5 | 维护任务发现相近记忆 | 产生并持久化关系记录，记录 `memory_relation_plan` | 已通过 | `services/retrieval-runtime/tests/maintenance-worker.test.ts` 已覆盖，相关测试通过 |
| S6 | 维护任务提炼长期知识 | 生成演化候选并写入存储，记录 `memory_evolution_plan` | 已通过 | `services/retrieval-runtime/tests/maintenance-worker.test.ts` 已覆盖，相关测试通过 |
| S7 | 运行轨迹页展示 plan 级事件 | 轨迹页能识别并展示 `intent / relation / recommendation / evolution` 新 plan 类型 | 已通过 | `services/visualization/tests/runtime-observe-client.test.ts`、`services/visualization/tests/run-trace-service.test.ts` 已覆盖，相关测试通过 |

---

## 4. 当前已验证结果

### 4.1 自动化测试

| 项目 | 预期指标 | 实际指标 | 结果 |
|---|---|---|---|
| `retrieval-runtime` 相关回归测试 | 100% 通过 | 62 / 62 = 100% | 通过 |
| `storage` 关系 API 测试 | 100% 通过 | 14 / 14 = 100% | 通过 |
| `visualization` plan 展示测试 | 100% 通过 | 10 / 10 = 100% | 通过 |
| 本轮相关自动化测试合计 | 100% 通过 | 86 / 86 = 100% | 通过 |

### 4.2 类型检查

| 项目 | 预期指标 | 实际指标 | 结果 |
|---|---|---|---|
| `retrieval-runtime` 类型检查 | 通过 | 通过 | 通过 |
| `storage` 类型检查 | 通过 | 通过 | 通过 |
| `visualization` 类型检查 | 通过 | 通过 | 通过 |

---

## 5. 验收指标表

### 5.1 已有实际值的工程验收指标

| 指标 | 口径 | 预期指标 | 实际指标 | 结果 |
|---|---|---|---|---|
| plan 面板覆盖率 | 新增 plan 类型是否可被轨迹页识别和展示 | 8 / 8 = 100% | 8 / 8 = 100% | 通过 |
| 相关测试通过率 | 本轮直接相关自动化测试是否通过 | 100% | 86 / 86 = 100% | 通过 |
| 类型检查通过率 | 三个相关服务类型检查是否通过 | 100% | 3 / 3 = 100% | 通过 |

> 当前 8 类 plan 包括：`memory_intent_plan`、`memory_search_plan`、`memory_injection_plan`、`memory_writeback_plan`、`memory_governance_plan`、`memory_relation_plan`、`memory_recommendation_plan`、`memory_evolution_plan`。

### 5.2 仍需采样的效果指标

| 指标 | 口径 | 预期指标 | 实际指标 | 当前状态 |
|---|---|---|---|---|
| 召回准确率 | 人工标注样本中，最终召回是否正确帮助当前问题 | > 80% | 未采集 | 待人工标注 |
| 治理正确率 | 治理动作是否符合预期，没有误归档、误合并、误删除 | > 85% | 未采集 | 待人工标注 |
| 低质量拦截率 | 质量评估对低质量候选的拦截效果 | > 80% | 未采集 | 待人工标注 |
| 优先级调整后命中率提升 | 效果反馈回写重要度后，对后续命中率的提升 | > 20% | 未采集 | 待近窗对比 |
| 意图理解准确率 | `intent analyzer`（意图分析器）对是否需要记忆、作用域、类型的判断准确率 | > 90% | 未采集 | 待人工标注 |
| 关联发现准确率 | `relation discoverer`（关系发现器）输出关系是否成立 | > 80% | 未采集 | 待人工标注 |
| 推荐采纳率 | 主动推荐是否被宿主/用户实际采用 | > 30% | 未采集 | 待产品埋点 |
| 知识提取准确率 | 演化提取出的长期知识是否正确、可复用 | > 85% | 未采集 | 待人工标注 |
| 用户满意度 | 面向真实使用者的主观反馈 | 完成调研 | 未采集 | 待产品调研 |

---

## 6. 建议的采样方法

### 6.1 样本量

- 第一轮先采 50 条到 100 条真实样本。
- 召回、意图、关联、知识提取建议分别独立标注，不共用一个结论。
- 治理类样本建议单独抽样，因为风险和判断口径不同。

### 6.2 标注字段

每条样本至少记录这些字段：

- 样本编号
- 原始输入
- 触发阶段
- 模型计划输出
- 实际执行结果
- 人工结论（正确 / 错误 / 部分正确）
- 错误原因

### 6.3 回写规则

- 工程验收指标允许直接写当前自动化结果。
- 效果指标没有采样前，一律写 `未采集`，不要填估计值。
- 每次补采后，只更新“实际指标”列，不改“预期指标”列。

---

## 7. 当前结论

按这份样本口径，当前可以得出的结论是：

- 功能开发验收已经完成。
- 工程回归和类型检查已经通过。
- 效果类指标还没有形成真实“实际值”，当前只能记为 `未采集`。
- 对外如果要表述当前状态，更准确的说法是：“功能已完成，效果指标待验收。”  
