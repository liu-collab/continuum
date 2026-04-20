# Memory-Native-Agent Skill 兼容方案（Codex / Claude Code 对齐版）

> 这版目标不再是做一个只在 MNA 内部可用的 `YAML`（配置文件）模板。
> 目标改成：让 MNA 能直接导入并运行现有的 `Codex skill`（Codex 技能）和 `Claude Code skill`（Claude Code 技能）包，尽量少改或不改原始文件。

---

## 1. 结论

如果目标是“用户把现成的 `Codex` / `Claude Code` skill 导进来就能用”，那当前旧方案不够。

主要原因有 3 个：

1. 市面上的 skill 主形态不是 `YAML task template`（YAML 任务模板），而是 `SKILL.md + frontmatter + Markdown 指令正文 + supporting files`（支持文件）。
2. `Claude Code` 的 `allowed-tools`（允许工具）语义是“免审批工具”，不是“唯一可见工具白名单”；旧方案这里是错位的。
3. 想说“兼容导入”，就不能只支持 `/skill xxx {"a":1}` 这种 MNA 自定义入口，还要支持现有的 `/<name>`、`.claude/commands/*.md`、`$ARGUMENTS`、`!command` 这些现成能力。

所以这版方案要改成：

`SKILL.md 兼容优先 + 多格式适配器 + 单 agent 运行时复用`

而不是：

`MNA 自定义 YAML DSL 优先`

---

## 2. 已确认的市场事实

### 2.1 Codex 本地 skill 形态

当前本地可见的 `Codex skill` 基本形态是：

- 一个目录
- 入口文件是 `SKILL.md`
- 顶部有很轻量的 `frontmatter`（前置元信息），至少有：
  - `name`
  - `description`
- 正文是 Markdown 指令，主要描述：
  - 什么时候用
  - 怎么做
  - 工具使用规则
  - 参考文件怎么读
- skill 目录下可能还会带：
  - `references/`
  - `scripts/`
  - 其他支持文件

换句话说，`Codex skill` 更像：

`instruction pack`（指令包）

不是：

`workflow DSL`（工作流 DSL）

### 2.2 Claude Code 官方 skill 形态

`Claude Code` 官方文档已经明确了这些点：

- skill 也是以 `SKILL.md` 为主入口
- `.claude/commands/*.md` 也能工作，而且官方已经把 custom commands 合并进 skills
- skill 支持两种触发方式：
  - Claude 自动触发
  - 用户直接输入 `/<name>`
- `Claude Code` 明确写了 skills follow `Agent Skills`（Agent Skills 开放标准）
- `SKILL.md` 也是 `frontmatter + Markdown 正文`
- 官方 frontmatter 字段包括：
  - `name`
  - `description`
  - `when_to_use`
  - `argument-hint`
  - `disable-model-invocation`
  - `user-invocable`
  - `allowed-tools`
  - `model`
  - `effort`
  - `context`
  - `agent`
  - `hooks`
  - `paths`
  - `shell`

另外官方还支持这些能力：

- supporting files
- nested directories 自动发现
- live change detection
- `$ARGUMENTS` / `$ARGUMENTS[n]` / `$0`
- `!command` 和 ` ```! ` 动态上下文注入

---

## 3. 旧最小方案还缺什么

如果要说“能导入现有 skill 并正常使用”，旧方案至少还缺下面这些：

1. 缺 `SKILL.md` 解析器，只支持自定义 `YAML` 文件。
2. 缺 skill 目录包模型，不能带 `references/`、`scripts/`、模板文件。
3. 缺 `.claude/commands/*.md` 兼容层。
4. 缺直接 `/<name>` 触发，只支持 `/skill <name>`。
5. 缺自动触发能力，无法根据 `description` / `when_to_use` 做路由。
6. 缺 `disable-model-invocation` 和 `user-invocable` 的控制语义。
7. 缺 `$ARGUMENTS`、`$ARGUMENTS[0]`、`$0` 参数展开。
8. 缺 `!command` / ` ```! ` 的动态上下文展开。
9. 缺 `paths` 条件激活。
10. 缺 `model` / `effort` 的每次 skill 执行覆盖。
11. 缺 `shell: powershell` 这类运行时差异。
12. 缺 nested discovery（嵌套目录发现）和 live reload（热发现）。
13. 缺“来源优先级”和“重名 skill 命名空间”。
14. 缺对 unsupported features（暂不支持能力）的显式报错。

还有一个很关键的问题：

15. 旧文档把 `allowed_tools` 当成“唯一工具白名单”。

这和 `Claude Code` 官方语义不一致。  
在 Claude 里，`allowed-tools` 表示：

`这些工具在 skill 激活时可以免审批使用`

而不是：

`除了这些工具，其他工具一律不可见`

如果沿用旧语义，导入进来的 skill 行为会失真。

---

## 4. 新目标边界

### 4.1 这版要达到的目标

第一阶段要做到下面这件事：

`Codex skill / Claude Code skill / Claude commands 可以被 MNA 直接扫描、导入、注册、触发，并在单 agent 主链路里正常跑起来。`

### 4.2 这版不直接承诺的东西

如果下面 3 个不做完，就不能宣称“Claude Code skill 全量兼容”：

- `context: fork`
- `agent`
- `hooks`

原因很简单：

- 这 3 个能力已经触到 subagent（子智能体）和 lifecycle hooks（生命周期钩子）
- 而你当前明确想先把单 `agent` 主链路跑通

所以这版要分成两层说法：

1. 第一阶段可宣称：
   - 兼容 `Codex skill`
   - 兼容 `Claude Code` 的大多数单 `agent` skill / command
2. 只有等 `context: fork` / `agent` / `hooks` 做完后，才能宣称：
   - 兼容 `Claude Code skill` 全量能力

---

## 5. 对外格式：以 `SKILL.md` 为主

### 5.1 外部标准格式

MNA 对外要以这些格式为主：

```text
SKILL.md
.claude/commands/*.md
```

不再把下面这个作为主格式：

```text
*.yaml
```

`YAML` 方案如果保留，也只能是：

`MNA 内部兼容格式`

不能再作为“市面兼容”的主标准。

### 5.2 Skill 包的目录结构

统一按“目录包”处理：

```text
my-skill/
  SKILL.md
  references/
  scripts/
  assets/
  templates/
```

这样才能对齐：

- `Codex` 的 skill 目录
- `Claude Code` 的 skill 目录

---

## 6. MNA 内部统一模型

外部格式可以很多，但内部要统一到一个 `SkillPackage`（技能包）模型。

```ts
export interface SkillPackage {
  id: string;
  name: string;
  description: string;
  whenToUse?: string;
  argumentHint?: string;

  source: {
    kind: "mna" | "codex" | "claude-skill" | "claude-command";
    rootDir: string;
    entryFile: string;
  };

  invocation: {
    userInvocable: boolean;
    modelInvocable: boolean;
    triggerPaths?: string[];
  };

  runtime: {
    markdown: string;
    shell?: "bash" | "powershell";
    model?: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    contextMode?: "inline" | "fork";
    agent?: string;
    hooks?: unknown;
  };

  tools: {
    preapprovedTools?: string[];
    visibleTools?: string[];
  };
}
```

这里有一个刻意的拆分：

- `preapprovedTools`：对齐 `Claude Code` 的 `allowed-tools`
- `visibleTools`：如果未来 MNA 自己要做严格可见工具限制，再单独扩展

不要把这两个语义混在一起。

---

## 7. 多格式导入适配器

### 7.1 必须有的适配器

```text
src/skills/adapters/
  codex-skill.ts
  claude-skill.ts
  claude-command.ts
  legacy-yaml.ts
```

### 7.2 各适配器职责

`codex-skill.ts`

- 读取 `SKILL.md`
- 解析最小 frontmatter：`name`、`description`
- 保留 Markdown 正文
- 建立 skill 根目录文件索引

`claude-skill.ts`

- 读取 `SKILL.md`
- 解析 Claude frontmatter 字段
- 处理 `user-invocable`、`disable-model-invocation`
- 处理 `allowed-tools`、`paths`、`shell`、`model`、`effort`

`claude-command.ts`

- 读取 `.claude/commands/*.md`
- 文件名默认转成 skill 名称
- frontmatter 如果存在则覆盖默认元信息
- 转成和 skill 一样的统一结构

`legacy-yaml.ts`

- 只作为历史兼容
- 不再作为对外主格式

---

## 8. 发现与导入

### 8.1 默认扫描来源

```text
~/.mna/skills/**/SKILL.md
.mna/skills/**/SKILL.md
~/.codex/skills/**/SKILL.md
~/.claude/skills/**/SKILL.md
.claude/skills/**/SKILL.md
.claude/commands/*.md
```

另外允许配置额外目录：

```yaml
skills:
  enabled: true
  watch: true
  sources:
    - "~/.mna/skills"
    - ".mna/skills"
    - "~/.codex/skills"
    - "~/.claude/skills"
    - ".claude/skills"
    - ".claude/commands"
    - "/custom/skill-dir"
```

### 8.2 必须支持的发现行为

1. 嵌套目录自动发现
2. 启动时全量扫描
3. 文件变化热更新
4. 删除后自动下线
5. 解析失败时给出明确错误

### 8.3 重名处理

同名 skill 不能只做静默覆盖。

需要同时支持：

1. 一个未带命名空间的主名字
2. 一个带来源作用域的稳定名字

例如：

```text
/openai-docs
/codex:openai-docs
/claude:deploy
```

未带作用域时按优先级选择：

```text
workspace-local > user-local > imported-external > bundled
```

---

## 9. 触发方式

### 9.1 用户显式触发

为了对齐现有习惯，第一入口要改成：

```text
/<skill-name> <arguments>
```

例如：

```text
/explain-code src/auth/login.ts
/deploy production
```

旧入口可以保留兼容：

```text
/skill <name> <arguments>
```

但它不应该再是主入口。

### 9.2 模型自动触发

对 `modelInvocable = true` 的 skill，需要支持自动候选：

- 依据 `description`
- 依据 `when_to_use`
- 依据 `paths`

第一阶段不必做复杂 planner（规划器），但至少要有：

`基于请求文本 + 当前工作文件的 skill 候选路由`

否则很多 `Claude Code` skill 的默认行为对不齐。

---

## 10. 参数与动态上下文兼容

### 10.1 参数展开

必须支持下面这些语法：

```text
$ARGUMENTS
$ARGUMENTS[0]
$ARGUMENTS[1]
$0
$1
```

行为要和 `Claude Code` 保持一致：

- 显式传参时替换
- 如果正文没有引用 `$ARGUMENTS`，则把参数以追加形式附到正文末尾

### 10.2 动态上下文注入

必须支持：

```text
!`command`
```!
command block
```
```

执行时机：

1. skill 被真正触发时
2. 在把 skill 正文注入模型前先执行
3. 用输出替换原占位内容

这一步不能省。  
否则很多 Claude skill 的动态上下文能力会直接失效。

### 10.3 Shell 兼容

要支持：

- `bash`
- `powershell`

并由 skill frontmatter 的 `shell` 控制。

---

## 11. supporting files 兼容

导入 skill 不能只读 `SKILL.md`。

还要保证这几点：

1. skill 根目录路径在运行时可见
2. skill 内相对路径能被正确解析
3. `references/`、`scripts/`、`templates/` 等目录能被读取
4. skill 删除或移动后，缓存索引同步更新

运行时建议增加两个内置变量：

```text
SKILL_ROOT
SKILL_NAME
```

同时在技能注入说明里明确告诉模型：

```text
当前 skill 的支持文件位于 {SKILL_ROOT}
```

这样导入 `Codex skill` 时，正文里提到的 `references/...` 和 `scripts/...` 才有稳定语义。

---

## 12. frontmatter 字段映射

### 12.1 第一阶段必须支持

| 字段 | 是否必须 | MNA 行为 |
| --- | --- | --- |
| `name` | 是 | skill 名和 slash 命令名 |
| `description` | 是 | skill 描述和自动触发候选文本 |
| `when_to_use` | 建议 | 自动触发补充文本 |
| `argument-hint` | 否 | 自动补全提示 |
| `disable-model-invocation` | 否 | 关闭自动触发 |
| `user-invocable` | 否 | 是否允许用户直接 `/name` |
| `allowed-tools` | 否 | 转成 `preapprovedTools` |
| `model` | 否 | 本次 skill 执行模型覆盖 |
| `effort` | 否 | 本次 skill 执行 effort 覆盖 |
| `paths` | 否 | 自动触发时的路径过滤 |
| `shell` | 否 | 动态命令用哪种 shell |

### 12.2 第一阶段先明确不承诺全支持

| 字段 | 当前结论 |
| --- | --- |
| `context` | 只有 `inline` 可支持；`fork` 需要 subagent |
| `agent` | 需要 subagent registry |
| `hooks` | 需要 skill lifecycle hook engine |

策略不要做成“静默忽略”。

如果导入 skill 用到了这些字段，而系统还没实现，应该明确返回：

```text
skill_unsupported_feature
```

并指出具体字段：

```text
context=forge
agent=Explore
hooks
```

---

## 13. 运行模型

第一阶段仍然复用现有 `AgentRunner`，但 skill 的运行方式要改成：

1. 发现并注册 `SkillPackage`
2. 用户直接 `/name` 或路由器自动选中 skill
3. 解析参数
4. 处理 `$ARGUMENTS`
5. 执行 `!command` 动态上下文
6. 组装 skill 正文
7. 应用本次 skill 的：
   - `model`
   - `effort`
   - `preapprovedTools`
8. 把 skill 正文注入本轮上下文
9. 进入现有 runner 主循环

这意味着：

- 不再把 skill 理解成“执行模板”
- 而是把 skill 理解成“可导入的上下文包 + 运行时约束”

这才和 `Codex` / `Claude Code` 更接近。

---

## 14. 推荐新增与修改的模块

### 14.1 新增

```text
src/skills/
  package.ts
  discovery.ts
  frontmatter.ts
  registry.ts
  router.ts
  runtime.ts
  arguments.ts
  shell-expander.ts
  watcher.ts
  resources.ts
  adapters/
    codex-skill.ts
    claude-skill.ts
    claude-command.ts
    legacy-yaml.ts
  index.ts
```

### 14.2 修改

```text
src/http/state.ts
  - 初始化 SkillRegistry、SkillDiscovery、watcher

src/http/ws/session-ws.ts
  - 支持直接 /<skill-name> 路由
  - 保留 /skill <name> 兼容

src/runner/agent-runner.ts
  - 支持 per-turn model / effort 覆盖
  - 支持 skill 指令注入

src/tools/dispatcher.ts
  - 支持 per-skill preapproved tools

src/config/schema.ts
  - 新增 skills.sources / watch / import 配置

src/config/defaults.ts
  - skills 默认来源
```

如果后面做完整 Claude 兼容，还会新增：

```text
src/agents/
src/hooks/
```

---

## 15. 测试范围

### 15.1 单元测试

必须补这些：

- `Codex SKILL.md` 解析
- `Claude SKILL.md` 解析
- `.claude/commands/*.md` 解析
- frontmatter 字段映射
- `$ARGUMENTS` / `$0` 参数替换
- `!command` 展开
- `allowed-tools` 映射成 `preapprovedTools`
- nested directory 发现
- 重名 skill 命名空间处理

### 15.2 集成测试

至少要有这些 fixture（样例目录）：

```text
tests/fixtures/skills/codex/
tests/fixtures/skills/claude/
tests/fixtures/skills/claude-commands/
```

集成用例至少覆盖：

1. 从 `.codex/skills` 导入 skill 并执行
2. 从 `.claude/skills` 导入 skill 并执行
3. 从 `.claude/commands` 导入命令并执行
4. `/<name>` 直接触发
5. 自动触发命中 `description` / `when_to_use`
6. `disable-model-invocation` 生效
7. `user-invocable: false` 生效
8. supporting files 可读
9. `paths` 过滤生效
10. 遇到 `context: fork` / `hooks` 时返回明确 unsupported error

---

## 16. 分阶段交付

### Phase 1：兼容核心层

完成后可以宣称：

`兼容 Codex skill + 兼容 Claude Code 的大多数单 agent skill / command`

必须包含：

- `SKILL.md` 目录包
- `.claude/commands` 兼容
- 直接 `/<name>` 调用
- 自动触发
- `$ARGUMENTS`
- `!command`
- supporting files
- `allowed-tools` 正确语义
- `model` / `effort` / `paths` / `shell`
- nested discovery + watch

### Phase 2：Claude 扩展能力补齐

完成后才可以宣称：

`Claude Code skill 全量兼容`

必须再补：

- `context: fork`
- `agent`
- `hooks`

---

## 17. 这版文档的状态

这版文档已经不再按“自定义 YAML skill”来定义第一版。

当前正式建议改成：

`SKILL.md 兼容包 + 多格式导入适配器 + /<name> 调用 + 自动触发 + supporting files + 参数替换 + 动态上下文 + 单 agent 运行时复用`

同时需要明确一条对外口径：

`如果 Phase 1 只做单 agent 兼容层，那我们可以说兼容 Codex skill 和 Claude Code 的大多数基础 skill；不能直接说 Claude Code skill 全量兼容。`

