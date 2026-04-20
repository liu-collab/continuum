# Memory-Native-Agent Skill 外部兼容方案

> 这版只解决一件事：
> `Codex` 和 `Claude Code` 的 skill，可以直接给 `MNA` 使用。

## 当前状态

- [x] 第一阶段交付标准已完成，当前实现已可作为 `MNA` 的外部 skill 兼容最小闭环
- [x] 已支持按路径导入 `Codex skill` 目录
- [x] 已支持按路径导入 `Claude Code skill` 目录
- [x] 已支持按路径导入 `.claude/commands/*.md`
- [x] 已支持 `CLI`（`mna skill import <path>`）导入
- [x] 已支持 `HTTP`（`POST /v1/skills/import`）导入
- [x] 已支持 `SKILL.md + frontmatter + Markdown + supporting files`
- [x] 已支持 `/<name>` 和 `/skill <name>` 触发
- [x] 已支持 `$ARGUMENTS` / `$ARGUMENTS[n]` / `$0`
- [x] 已支持 `!command` 展开
- [x] 已支持 `allowed-tools -> preapprovedTools`
- [x] 已对 `context` / `agent` / `hooks` 返回 `skill_unsupported_feature`
- [x] 已补充单元测试与 HTTP / websocket / runner 侧集成测试
- [x] 已支持可选自动发现，并默认关闭

这版已按第一阶段目标落地，后续如果要继续做的是：

- [ ] `allow-partial`（宽松导入）
- [ ] `context: fork`
- [ ] `agent`
- [ ] `hooks`

---

## 1. 目标先说清楚

这次目标不是：

- 让 `MNA` 把 skill 导出回 `Codex`
- 让 `MNA` 把 skill 导出回 `Claude Code`
- 只做扫描本地目录这种很窄的接入方式

这次真正的目标是：

- 用户手里已经有一个 `Codex skill`
- 或者已经有一个 `Claude Code skill`
- 这个 skill 可以直接导入 `MNA`
- 然后由 `MNA` 正常注册、触发、运行

一句话就是：

`host skill -> MNA runtime`（宿主 skill 直接进入 MNA 运行时）

---

## 2. 调研后的事实

### 2.1 Codex skill 的实际形态

目前本地能看到的 `Codex skill` 形态很稳定：

- skill 是一个目录
- 入口文件是 `SKILL.md`
- 顶部是轻量 `frontmatter`（前置元信息）
- 当前稳定可见字段至少有：
  - `name`
  - `description`
- 正文是 Markdown 指令
- skill 目录里可能还会带：
  - `references/`
  - `scripts/`
  - 其他支持文件

也就是说，`Codex skill` 更像：

`instruction pack`（指令包）

### 2.2 Claude Code skill 的官方形态

`Claude Code` 官方 skill 形态更完整：

- skill 也是目录
- 入口也是 `SKILL.md`
- `.claude/commands/*.md` 也可以视作同类能力
- 支持 `frontmatter + Markdown 正文`
- 官方字段包括：
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

另外它还支持：

- `/skill-name`
- `$ARGUMENTS`
- `$ARGUMENTS[n]`
- `$0` / `$1`
- `!command`
- supporting files

### 2.3 共同结论

如果想让外部 skill 直接给 `MNA` 用，`MNA` 就必须把下面这套东西当成一等输入：

`SKILL.md + frontmatter + Markdown 正文 + supporting files`

而不能继续只围着自定义 `YAML DSL`（YAML 定义格式）转。

---

## 3. 这对 MNA 意味着什么

之前那种最小方案里，skill 被定义成：

`system_prompt + execution_prompt + parameters + allowed_tools`

这种结构的问题不是不能跑，而是：

`它不是 Codex / Claude Code skill 的原生形态。`

如果目标是“外部 skill 可以直接给 MNA 使用”，那 MNA 内部必须改成：

`外部 skill 原生格式优先，MNA 私有格式退到兼容层。`

也就是说：

1. `SKILL.md` 必须成为主输入格式
2. 目录包必须成为主载体
3. MNA 的额外能力不能强塞回公共 skill 主文件里

---

## 4. 第一阶段到底要支持什么

### 4.1 必须支持的输入

第一阶段建议直接支持 3 类输入：

1. `Codex skill` 目录

```text
some-skill/
  SKILL.md
  references/
  scripts/
```

2. `Claude Code skill` 目录

```text
.claude/skills/some-skill/
  SKILL.md
  references/
  scripts/
```

3. `Claude Code command` 文件

```text
.claude/commands/deploy.md
```

### 4.2 不要把实现缩成“只能扫描目录”

“直接给 MNA 使用”不应该只等于：

`MNA 启动时扫描固定目录`

这只是可选接入方式之一。

第一阶段应该至少支持：

- `CLI`（命令行）按路径导入
- `HTTP`（接口）按路径或上传导入
- 可选的约定目录扫描

所以更合理的入口是：

```text
mna skill import <path>
POST /v1/skills/import
```

而不是只写：

```text
扫描 ~/.codex/skills
```

---

## 5. MNA 内部需要统一成什么模型

外部格式可以多种多样，但导进来后，内部要统一成一个 `SkillPackage`（技能包）模型。

```ts
export interface SkillPackage {
  id: string;
  name: string;
  description: string;
  whenToUse?: string;
  argumentHint?: string;

  source: {
    kind: "codex-skill" | "claude-skill" | "claude-command" | "mna-legacy";
    rootDir: string;
    entryFile: string;
  };

  content: {
    markdown: string;
    resources: SkillResource[];
  };

  invocation: {
    userInvocable: boolean;
    modelInvocable: boolean;
    slashName: string;
    triggerPaths?: string[];
  };

  runtime: {
    shell?: "bash" | "powershell";
    model?: string;
    effort?: "low" | "medium" | "high" | "xhigh" | "max";
    contextMode?: "inline" | "fork";
    agent?: string;
    hooks?: unknown;
  };

  permissions: {
    preapprovedTools?: string[];
  };
}

export interface SkillResource {
  kind: "reference" | "script" | "asset" | "other";
  relativePath: string;
  absolutePath: string;
}
```

这里最重要的一点是：

`Claude Code` 的 `allowed-tools` 不要翻译成“唯一可见工具白名单”。

它更接近：

`preapprovedTools`（预批准工具）

这个语义如果翻错，导进来的 skill 行为会失真。

---

## 6. 第一阶段还缺哪些能力

如果目标是“外部 skill 直接给 MNA 使用”，当前最缺的是这些：

1. 缺 `SKILL.md` 解析器
2. 缺 `frontmatter` 解析与字段映射
3. 缺 skill 目录包模型
4. 缺 supporting files 索引
5. 缺 `Codex skill` 适配器
6. 缺 `Claude Code skill` 适配器
7. 缺 `.claude/commands/*.md` 适配器
8. 缺按路径导入能力
9. 缺导入校验能力
10. 缺 `$ARGUMENTS` / `$0` 参数展开
11. 缺 `!command` 动态上下文展开
12. 缺对不支持字段的明确报错

现在最关键的不是“再发明一套 skill 格式”，而是：

`把已有外部 skill 格式稳稳接进来。`

---

## 7. 导入方式建议

### 7.1 CLI 导入

建议支持：

```text
mna skill import <path>
```

路径可以是：

- 一个 skill 目录
- 一个 `.md` 命令文件
- 后续可扩展成压缩包

### 7.2 HTTP 导入

建议支持：

```text
POST /v1/skills/import
```

请求体至少支持：

```json
{
  "path": "/absolute/path/to/skill"
}
```

后续如果需要，再补文件上传。

### 7.3 可选的自动发现

自动发现可以做，但只能算辅助能力：

- `.mna/skills/`
- `.claude/skills/`
- `.claude/commands/`
- `~/.codex/skills/`

它不是这次的主目标。

---

## 8. 外部字段怎么映射到 MNA

### 8.1 Codex skill

`Codex skill` 第一阶段至少映射：

| 外部字段 | MNA 字段 |
| --- | --- |
| `name` | `name` |
| `description` | `description` |
| Markdown 正文 | `content.markdown` |
| supporting files | `content.resources` |

### 8.2 Claude Code skill

`Claude Code skill` 第一阶段至少映射：

| 外部字段 | MNA 字段 |
| --- | --- |
| `name` | `name` |
| `description` | `description` |
| `when_to_use` | `whenToUse` |
| `argument-hint` | `argumentHint` |
| `disable-model-invocation` | `modelInvocable=false` |
| `user-invocable` | `userInvocable` |
| `allowed-tools` | `preapprovedTools` |
| `model` | `runtime.model` |
| `effort` | `runtime.effort` |
| `paths` | `triggerPaths` |
| `shell` | `runtime.shell` |

### 8.3 Claude commands

`.claude/commands/*.md` 建议映射成：

- `slashName`：取文件名
- `userInvocable=true`
- `modelInvocable=false`

原因很简单：

command 更接近“用户明确触发”，不是“模型自动挑选”。

---

## 9. 哪些能力第一阶段不能假装已经支持

下面这些能力只要没做完，就不能写成“兼容”：

- `context: fork`
- `agent`
- `hooks`

原因是它们已经触到：

- subagent（子智能体）
- lifecycle hooks（生命周期钩子）

这已经超出“把 skill 直接导进 MNA 运行”的最小闭环。

所以第一阶段的策略应该是：

### 9.1 默认严格模式

如果导入 skill 里出现这些字段，直接返回：

```text
skill_unsupported_feature
```

并指出具体字段。

### 9.2 可选宽松模式

如果后面要支持宽松导入，可以加：

```text
mna skill import <path> --allow-partial
```

行为是：

- skill 可以导入
- 但状态标成 `partial`
- 明确列出被忽略的字段

第一阶段建议先不做宽松模式，先把语义守住。

---

## 10. 运行方式

第一阶段仍然复用现有 `AgentRunner`，但 skill 运行入口要改成：

1. 导入 skill 包
2. 解析成 `SkillPackage`
3. 注册到 `SkillRegistry`
4. 用户通过：
   - `/<name>`
   - `/skill <name>`
   触发 skill
5. 处理参数展开
6. 处理 `!command`
7. 读取 skill 目录支持文件
8. 把 skill 正文和资源上下文交给现有 runner

也就是说：

第一阶段 skill 仍然是：

`改变输入上下文和局部运行约束`

而不是：

`重新做一套完整编排引擎`

---

## 11. 推荐新增模块

```text
src/skills/
  types.ts
  frontmatter.ts
  resources.ts
  registry.ts
  importer.ts
  validator.ts
  runtime.ts
  arguments.ts
  shell-expander.ts
  adapters/
    codex-skill.ts
    claude-skill.ts
    claude-command.ts
    legacy-yaml.ts
  index.ts
```

### 11.1 关键职责

`importer.ts`

- 按路径读入 skill
- 判断类型
- 调对应适配器

`validator.ts`

- 校验 skill 是否可被 MNA 接受
- 拦 unsupported fields

`resources.ts`

- 收集 `references/`、`scripts/` 等支持文件

`shell-expander.ts`

- 处理 `!command`

`arguments.ts`

- 处理 `$ARGUMENTS`、`$0` 等替换

---

## 12. 推荐修改的现有模块

```text
src/http/state.ts
  - 初始化 SkillRegistry

src/http/ws/session-ws.ts
  - 支持 /<skill-name>
  - 保留 /skill <name>

src/runner/agent-runner.ts
  - 支持 skill 正文注入
  - 支持 per-skill model / effort 覆盖

src/tools/dispatcher.ts
  - 支持 preapprovedTools 语义

src/config/schema.ts
  - skills.import / validation / optional discovery 配置

src/config/defaults.ts
  - skills 默认配置
```

---

## 13. 测试范围

### 13.1 单元测试

至少补这些：

- `Codex SKILL.md` 解析
- `Claude SKILL.md` 解析
- `.claude/commands/*.md` 解析
- supporting files 索引
- `$ARGUMENTS` / `$0` 展开
- `!command` 展开
- `allowed-tools` 正确映射
- unsupported feature 校验

### 13.2 集成测试

至少补这些样例：

```text
tests/fixtures/skills/codex-minimal/
tests/fixtures/skills/claude-basic/
tests/fixtures/skills/claude-command/
tests/fixtures/skills/claude-unsupported/
```

集成测试至少覆盖：

1. 通过路径导入 `Codex skill`
2. 通过路径导入 `Claude skill`
3. 通过路径导入 `.claude/commands/*.md`
4. 导入后能列出 skill
5. 能通过 `/<name>` 触发
6. 参数替换生效
7. `!command` 生效
8. supporting files 可被读取
9. 遇到 `context/agent/hooks` 明确报错

---

## 14. 第一阶段交付标准

满足下面这些，就算第一版闭环：

1. `Codex skill` 目录可以导入到 `MNA`
2. `Claude Code skill` 目录可以导入到 `MNA`
3. `.claude/commands/*.md` 可以导入到 `MNA`
4. 导入后 skill 可以注册并触发
5. `SKILL.md` 正文和 supporting files 能被正确使用
6. `$ARGUMENTS` 和 `!command` 能跑通
7. 不支持的高级字段会明确拦截

---

## 15. 这版结论

现在最值得做的，不是“再定义一套只属于 MNA 的 skill 格式”。

现在最值得做的是：

`把 Codex / Claude Code 的 skill 原生格式，作为 MNA 的一等输入接进来。`

这版最合理的落地方向是：

`SKILL.md 原生兼容 + 路径导入 + supporting files + 参数展开 + 动态上下文 + 明确的 unsupported feature 校验`

这样做完以后，才能真正说：

`Codex 的 skill 和 Claude Code 的 skill，可以直接给 MNA 使用。`
