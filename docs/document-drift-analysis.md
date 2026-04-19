# 文档漂移分析报告

**生成时间**: 2026-04-19  
**分析范围**: docs/ 目录下的核心产品文档与实际代码实现的一致性

---

## 执行摘要

基于最近两周的提交记录和当前代码实现，对核心产品文档进行了系统性漂移检查。发现 **3 处明确的文档-代码漂移**，以及 **2 处潜在的契约不一致风险**。

### 漂移严重程度分类
- 🔴 **严重漂移**（P0）：1 处 - 影响产品核心契约
- 🟡 **中度漂移**（P1）：2 处 - 影响用户体验和可观测性
- 🟢 **轻度漂移**（P2）：2 处 - 文档滞后但不影响功能

---

## 一、核心产品文档状态

### 1.1 已验证的文档

| 文档 | 状态 | 最后更新 | 与代码一致性 |
|------|------|----------|-------------|
| `product-baseline.md` | ✅ 稳定 | 早期 | 高度一致 |
| `memory-module-contract.md` | ✅ 稳定 | 早期 | 高度一致 |
| `architecture-independence.md` | ✅ 稳定 | 早期 | 高度一致 |
| `api-contract.md` | ✅ 稳定 | 早期 | 高度一致 |
| `current-phase-closure-plan.md` | ⚠️ 部分漂移 | 早期 | 中度一致 |
| `memory-native-agent/README.md` | ✅ 同步 | 最近 | 高度一致 |
| `retrieval-runtime-improvement-proposals-round2.md` | ⚠️ 滞后 | 最近 | 需要更新 |

---

## 二、发现的文档漂移

### 🔴 P0 严重漂移

#### 2.1 运行轨迹页筛选参数不一致

**文档声明** (`current-phase-closure-plan.md` 第 5.4 节):
```
当前正式支持的运行轨迹筛选只保留：
- turn_id
- session_id
- trace_id
- page
- page_size

thread_id、workspace_id、task_id 不再在首版里假装是正式筛选项。
```

**实际代码**:
- ✅ `services/visualization/src/app/memories/page.tsx` - 记忆页面已移除 `thread_id` 筛选
- ❌ `services/visualization/src/lib/query-params.ts` - 仍包含 `workspace_id` 解析逻辑
- ❌ `services/visualization/src/lib/server/runtime-observe-client.ts` - 可能仍传递未支持的参数

**影响**:
- 用户可能尝试使用 `workspace_id` / `task_id` 筛选轨迹，但后端不支持
- 页面展示与实际能力不符，造成误导

**建议**:
1. 审查 `runtime-observe-client.ts` 的查询参数构造逻辑
2. 确认 retrieval-runtime 的观测接口实际支持的参数
3. 移除前端所有未支持的筛选项
4. 补充跨服务测试验证筛选参数一致性

---

### 🟡 P1 中度漂移

#### 2.2 治理闭环的页面入口状态

**文档声明** (`current-phase-closure-plan.md` 第 7 节):
```
首版必须正式支持下面这些治理动作：
- confirm（确认）
- edit（修正）
- invalidate（标记失效）
- archive（归档）
- delete（软删除）
- restore_version（恢复历史版本）

当前补充：
- storage 已经在这个最小闭环基础上继续收成双边冲突治理闭环
- 剩余待收内容主要在页面治理入口和跨服务联调展示
```

**实际代码**:
- ✅ `services/storage/src/` - 75 处 `confirm/invalidate` 相关代码，治理动作已实现
- ✅ `services/visualization/src/features/memory-catalog/governance-panel.tsx` - 治理面板已实现
- ✅ `services/visualization/src/app/memories/[id]/page.tsx` - 详情页已集成治理面板
- ✅ 支持的动作：`confirm`, `invalidate`, `archive`, `delete`

**漂移点**:
- 文档说"剩余待收内容主要在页面治理入口"，但实际上页面治理入口**已经实现**
- 文档未更新反映当前进度

**影响**:
- 文档给人"治理页面还没做"的印象，但实际已完成
- 可能导致重复工作或误判项目进度

**建议**:
1. 更新 `current-phase-closure-plan.md` 第 7 节，标记页面治理入口为"已完成"
2. 补充验收标准：用户可在 `/memories/[id]` 页面执行治理动作
3. 确认 `edit` 和 `restore_version` 是否已实现（代码中未明确看到）

---

#### 2.3 retrieval-runtime round2 改进的实现状态

**文档声明** (`retrieval-runtime-improvement-proposals-round2.md`):
```
| R02 | 写回候选引入本地 outbox 与重试 | 待推进 | P0 |
| R05 | 打分权重按 phase 配置 | 待推进 | P1 |
| R06 | LLM extractor 质量门 + finalize 幂等 | 待推进 | P2 |
```

**实际代码**:
- ✅ `migrations/0004_runtime_writeback_outbox.sql` - outbox 表已创建
- ✅ `src/writeback/finalize-idempotency-cache.ts` - 幂等缓存已实现（LRU + TTL）
- ✅ `src/writeback/writeback-outbox-flusher.ts` - 后台刷新器已实现
- ✅ `src/observability/postgres-runtime-repository.ts` - outbox CRUD 已实现
- ✅ `src/query/query-engine.ts:39-53` - 按 phase 的权重配置已实现

**漂移点**:
- R02、R05、R06 标记为"待推进"，但实际代码**已完成**
- 文档创建时间是最近（commit `adfdae3`），但未同步更新实现状态

**影响**:
- 开发团队可能误以为这些功能还需要实现
- 代码审查时可能遗漏已实现的功能

**建议**:
1. 更新 `retrieval-runtime-improvement-proposals-round2.md` 状态表格：
   - R02: `待推进` → `已完成`
   - R05: `待推进` → `已完成`
   - R06: `待推进` → `已完成`（幂等部分）
2. 补充实现细节章节，说明 outbox 和幂等缓存的设计选择
3. 更新验收标准，确认这些功能已通过测试

---

### 🟢 P2 轻度漂移

#### 2.4 memory-native-agent 验收清单的自动化状态

**文档声明** (`memory-native-agent/acceptance-checklist.md`):
```
## 1. 基础启动
- [未开始] continuum start 后，所有服务都能启动
- [未开始] continuum status 能看到 mna 状态
```

**实际代码**:
- ✅ `services/visualization/tests/agent-e2e/` - 7 个 Playwright 测试文件
- ✅ `agent-core.spec.ts` - 核心交互测试
- ✅ `agent-recovery.spec.ts` - 降级恢复测试
- ✅ `dev-stack.ts` - 测试环境启动脚本

**漂移点**:
- 文档标记为"未开始"，但实际已有部分自动化测试覆盖
- 测试基础设施已搭建，但文档未反映

**影响**:
- 低 - 主要影响进度跟踪的准确性

**建议**:
1. 更新验收清单，将已有自动化测试的项目标记为"进行中"或"自动化通过"
2. 明确区分"人工验收"和"自动化测试"
3. 补充测试覆盖率说明

---

#### 2.5 interactive-test-plan.md 的未提交修改

**文档状态**:
- 有 +168 行未提交的修改
- 扩展了 token route 的错误场景（13.7-13.9）

**漂移点**:
- 文档已更新但未提交，处于"草稿"状态

**影响**:
- 低 - 不影响功能，但可能导致协作混乱

**建议**:
1. 提交这些文档更新
2. 确认新增的测试场景是否已实现

---

## 三、潜在的契约不一致风险

### 3.1 scope 分类仲裁权未统一（R01）

**契约要求** (`retrieval-runtime-improvement-proposals-round2.md` R01):
```
storage 应是 scope 的最终仲裁者
runtime 和 storage 的分类规则应统一
```

**实际代码**:
- ❌ `retrieval-runtime/src/writeback/writeback-engine.ts` 有 `classifyScope()` 方法
- ❌ `storage/src/domain/normalizer.ts` 有 `classifyCandidateScope()` 方法
- ❌ 两边规则未统一，没有共享词表

**风险**:
- 同一条候选从 runtime 发到 storage 后，scope 可能变化
- 影响召回边界稳定性

**建议**:
- 按 R01 建议实施：明确 storage 为最终仲裁者，runtime 改为轻量提示
- 整理共享词表到契约文档
- 补跨服务测试

---

### 3.2 recent_context_summary 构造规则未明确（R04）

**契约要求** (`retrieval-runtime-improvement-proposals-round2.md` R04):
```
在契约中明确 recent_context_summary 的构造规则
三个宿主应复用同一组测试 fixture
```

**实际代码**:
- ✅ `query-engine.ts:55-62` 已实现截断逻辑
- ❌ 契约文档未明确构造规则
- ❌ 三个宿主没有共享测试

**风险**:
- 同一用户输入在不同宿主可能得到不同的 semantic_query_text
- 召回效果不稳定

**建议**:
- 在 `memory-module-contract.md` 补充构造规则
- 创建共享测试 fixture

---

## 四、文档一致性良好的部分

### 4.1 核心架构契约

✅ **高度一致**:
- `product-baseline.md` - 产品目标和三层架构定义清晰，代码完全符合
- `architecture-independence.md` - 三服务独立性约束，代码严格遵守
- `memory-module-contract.md` - 模块职责边界，代码实现对齐

### 4.2 memory_mode 实现

✅ **完全一致**:
- 文档定义：`workspace_only` / `workspace_plus_global`
- 代码实现：`services/retrieval-runtime/src/api/schemas.ts` 完全匹配
- 三个宿主适配器都正确传递 `memory_mode`

### 4.3 scope 边界定义

✅ **完全一致**:
- 文档定义：`session` / `task` / `workspace` / `user`
- 代码实现：storage 和 runtime 都正确支持四种 scope
- 页面展示：`/memories` 页面正确区分全局记忆和工作区记忆

---

## 五、建议的修正优先级

### 立即修正（本周内）

1. **更新 retrieval-runtime round2 文档**
   - 将 R02、R05、R06 标记为"已完成"
   - 补充实现说明

2. **提交 interactive-test-plan.md 修改**
   - 提交未提交的 token 错误场景扩展

### 短期修正（2 周内）

3. **审查运行轨迹页筛选参数**
   - 确认 runtime 观测接口实际支持的参数
   - 移除前端未支持的筛选项
   - 补充跨服务测试

4. **更新 current-phase-closure-plan.md**
   - 标记页面治理入口为"已完成"
   - 更新验收标准

### 中期修正（1 个月内）

5. **统一 scope 分类仲裁权（R01）**
   - 明确 storage 为最终仲裁者
   - 整理共享词表
   - 补跨服务测试

6. **明确 recent_context_summary 构造规则（R04）**
   - 在契约文档中补充规则
   - 创建共享测试 fixture

---

## 六、预防文档漂移的建议

### 6.1 流程改进

1. **代码-文档同步检查点**
   - 功能实现完成时，同步更新相关文档
   - PR 审查时检查文档更新

2. **定期漂移审查**
   - 每月执行一次文档-代码一致性检查
   - 使用自动化工具检测接口变更

3. **契约测试**
   - 为核心契约编写跨服务测试
   - 测试失败时同步更新文档

### 6.2 文档维护规范

1. **状态标记**
   - 文档中明确标记"已完成" / "进行中" / "待开始"
   - 使用日期标记最后验证时间

2. **变更日志**
   - 重要文档维护变更日志
   - 记录每次更新的原因和范围

---

## 七、总结

### 整体评估

当前文档质量：**良好**

- 核心产品文档（product-baseline, memory-module-contract, architecture-independence）与代码**高度一致**
- 主要漂移集中在**实现进度更新滞后**，而非设计方向偏离
- 没有发现严重的"文档说有但代码没做"的情况
- 发现的漂移主要是"代码已做但文档未更新"

### 关键发现

1. **好消息**：核心架构契约稳定，代码严格遵守
2. **需要关注**：round2 改进已实现但文档未更新
3. **潜在风险**：scope 分类和 recent_context_summary 的跨服务一致性

### 下一步行动

**本周**：更新 round2 文档状态，提交未提交的修改  
**两周内**：审查轨迹页筛选参数，更新收口计划文档  
**一个月内**：实施 R01 和 R04 的契约统一方案

---

**报告生成者**: Claude (Sonnet 4.6)  
**分析方法**: 基于 git 历史、代码实现和文档内容的交叉验证
