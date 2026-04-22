# 记忆编排器测试样本与验收指标

> 配套文档：`memory-orchestrator-design.md`。  
> 记录时间：2026-04-22。  
> 说明：本文里的“实际指标”分两类记录。  
> 1. 已有自动化测试或类型检查结果的，直接填写当前结果。  
> 2. 需要人工标注、线上采样或产品反馈的，当前明确写为“未采集”。  
> 3. 本文已补充一轮本地真实模型离线评测结果，模型为 `gpt-5.3-codex-spark`（本地 `openai-compatible` 接口）。

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

### 4.1.1 真实模型离线评测

| 项目 | 预期指标 | 实际指标 | 结果 |
|---|---|---|---|
| `intent_accuracy`（意图理解准确率） | > 90% | 2 / 2 = 100% | 通过 |
| `recall_accuracy_proxy`（召回准确率代理值） | > 80% | 1 / 2 = 50% | 未达标 |
| `low_quality_intercept_rate`（低质量拦截率） | > 80% | 1 / 1 = 100% | 通过 |
| `relation_discovery_accuracy`（关联发现准确率） | > 80% | 1 / 1 = 100% | 通过 |
| `recommendation_relevance_proxy`（推荐相关性代理值） | 暂无硬阈值 | 1 / 1 = 100% | 通过 |
| `knowledge_extraction_accuracy`（知识提取准确率） | > 85% | 1 / 1 = 100% | 通过 |
| `governance_correctness_proxy`（治理正确率代理值） | > 85% | 1 / 1 = 100% | 通过 |
| `effectiveness_adjustment_direction_proxy`（效果反馈方向代理值） | 暂无硬阈值 | 1 / 1 = 100% | 通过 |

> 真实模型离线评测报告：`services/retrieval-runtime/docs/memory-orchestrator-real-llm-eval.md`  
> 真实模型原始结果：`services/retrieval-runtime/docs/memory-orchestrator-real-llm-eval.json`

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
| 召回准确率 | 人工标注样本中，最终召回是否正确帮助当前问题 | > 80% | 离线代理值 50%，人工值未采集 | 待补人工标注 |
| 治理正确率 | 治理动作是否符合预期，没有误归档、误合并、误删除 | > 85% | 离线代理值 100%，人工值未采集 | 待补人工标注 |
| 低质量拦截率 | 质量评估对低质量候选的拦截效果 | > 80% | 离线代理值 100%，人工值未采集 | 待补人工标注 |
| 优先级调整后命中率提升 | 效果反馈回写重要度后，对后续命中率的提升 | > 20% | 未采集 | 待近窗对比 |
| 意图理解准确率 | `intent analyzer`（意图分析器）对是否需要记忆、作用域、类型的判断准确率 | > 90% | 离线代理值 100%，人工值未采集 | 待补人工标注 |
| 关联发现准确率 | `relation discoverer`（关系发现器）输出关系是否成立 | > 80% | 离线代理值 100%，人工值未采集 | 待补人工标注 |
| 推荐采纳率 | 主动推荐是否被宿主/用户实际采用 | > 30% | 未采集 | 待产品埋点 |
| 知识提取准确率 | 演化提取出的长期知识是否正确、可复用 | > 85% | 离线代理值 100%，人工值未采集 | 待补人工标注 |
| 用户满意度 | 面向真实使用者的主观反馈 | 完成调研 | 未采集 | 待产品调研 |

---

## 6. 本地真实模型测试配置

本轮离线评测使用的是本地已配置好的真实模型接口：

- 模型：`gpt-5.3-codex-spark`
- 协议：`openai-compatible`
- 地址：`http://localhost:8090/v1`
- `api key`（接口密钥）：复用 `mna`（memory-native-agent） 已配置的托管密钥

说明：

- 这轮不是 mock（模拟）测试，走的是当前仓库真实 `prompt`（提示词）、真实 `schema`（结构校验）和真实 LLM 调用链路。
- 评测脚本位置：`services/retrieval-runtime/src/cli/memory-orchestrator-real-eval.ts`
- 真实模型兼容修复已落到 `services/retrieval-runtime/src/memory-orchestrator/llm-client.ts`，会对不支持 `response_format`（结构化输出约束）的兼容端点自动降级重试。

---

## 7. 本轮实际测试提示词样本

下面列 4 条代表性样本，完整提示词和原始输出见 `memory-orchestrator-real-llm-eval.md`。

### 7.1 样本 A：意图理解

- 模块：`intent analyzer`（意图分析器）
- 用户输入：`继续昨天那个 memory orchestrator 验收，把测试样本文档补完整，格式还是按之前那版。`
- 预期：判断需要记忆，识别任务连续性
- 实际：通过

### 7.2 样本 B：注入规划

- 模块：`recall injection planner`（注入规划器）
- 用户输入：`继续把测试样本文档写完，按之前的短句中文风格来。`
- 候选记忆：
- `用户偏好：默认中文，先给一句结论，再补最多 3 个短点。`
- `当前任务：正在补 memory orchestrator 测试样本文档的实际指标。`
- 预期：选中风格偏好和当前任务状态
- 实际：通过，实际选中 `mem-style-1 + mem-task-1`

### 7.3 样本 C：低质量拦截

- 模块：`quality assessor`（质量评估器）
- 写回候选：`好的，我来处理。`
- 预期：判为低质量，不应作为稳定记忆写回
- 实际：通过，模型给出 `quality_score = 0.12`

### 7.4 样本 D：检索规划失败样本

- 模块：`recall search planner`（检索规划器）
- 用户输入：`继续刚才那份 memory orchestrator 测试报告，把真实模型的实际指标补上。`
- 预期：触发检索，并返回合法整数 `importance_threshold`（重要度阈值）
- 实际：未通过，模型返回了不符合 `schema`（结构约束）的浮点阈值，导致结构校验失败

---

## 8. 建议的采样方法

### 8.1 样本量

- 第一轮先采 50 条到 100 条真实样本。
- 召回、意图、关联、知识提取建议分别独立标注，不共用一个结论。
- 治理类样本建议单独抽样，因为风险和判断口径不同。

### 8.2 标注字段

每条样本至少记录这些字段：

- 样本编号
- 原始输入
- 触发阶段
- 模型计划输出
- 实际执行结果
- 人工结论（正确 / 错误 / 部分正确）
- 错误原因

### 8.3 回写规则

- 工程验收指标允许直接写当前自动化结果。
- 效果指标没有采样前，一律写 `未采集`，不要填估计值。
- 每次补采后，只更新“实际指标”列，不改“预期指标”列。

---

## 9. 当前结论

按这份样本口径，当前可以得出的结论是：

- 功能开发验收已经完成。
- 工程回归和类型检查已经通过。
- 已经有一轮真实模型离线代理值，其中大部分模块通过，当前唯一明确暴露的问题是检索规划的数值输出和 `schema` 约束还不够稳。
- 人工标注、线上采纳率和满意度这类效果指标仍然没有形成正式“实际值”。
- 对外如果要表述当前状态，更准确的说法是：“功能已完成，真实模型离线评测已跑通，线上效果指标待验收。”  
