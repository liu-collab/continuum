# visualization 开发提示词

## 1. 这份提示词给谁

这份提示词给负责 `services/visualization` 的开发 agent。

你的任务是把“结构化记忆可视化 + 运行轨迹查看 + 指标看板”这一层直接落成独立平台，而不是只做几个页面壳子。

## 2. 先读哪些文档

开始写代码前，先完整阅读下面这些文档，并以它们为准：

- `docs/architecture-independence.md`
- `docs/memory-module-contract.md`
- `docs/visualization/memory-observability-product.md`
- `docs/visualization/visualization-service-design.md`
- `docs/visualization/visualization-implementation-spec.md`
- `services/visualization/README.md`

如果文档之间出现冲突，优先级按下面执行：

1. `architecture-independence.md`
2. `memory-module-contract.md`
3. `visualization-implementation-spec.md`
4. 其他说明文档

## 3. 你负责的范围

你只负责 `visualization` 这一层。

代码目录固定在：

- `services/visualization`

这层要做的是：

- 展示正式记忆目录
- 展示单轮运行轨迹
- 展示关键指标看板
- 展示数据源健康状态
- 为开发和排查提供统一入口

这层不做的是：

- 不直接改写记忆内容
- 不直接参与运行时召回决策
- 不读取其他服务的私有运行内存
- 不要求上游服务在线才能启动页面

## 4. 这层要解决什么问题

你要通过代码解决下面这些问题：

### 4.1 记忆库里有什么看不清

需要把结构化记忆直接展示出来，而不是要求开发者去查数据库。

### 4.2 某一轮为什么查了或没查看不清

需要能按 `turn_id` 把触发、查询、注入、写回顺着看下来。

### 4.3 系统慢在哪里看不清

需要把触发率、命中率、空检索率、P95、写回成功率等指标做成统一看板。

### 4.4 上游挂了时页面不能一起死

需要让可视化层自己先能启动，再把上游不可用状态清楚显示出来。

### 4.5 页面不能绑死上游内部实现

需要只消费正式接口和共享读模型，而不是直接读私有表或私有状态。

## 5. 你具体要做什么

### 5.1 初始化前端服务工程

在 `services/visualization` 下补齐这批基础文件：

- `package.json`
- `tsconfig.json`
- `next.config.ts`
- `tailwind.config.ts`
- `postcss.config.js`
- 组件库初始化文件
- `.env.example` 的正式字段说明

### 5.2 实现数据源适配层

要把页面依赖的数据源收敛成明确的 client 和 DTO 转换层。

可接入的数据源固定为：

- `storage` 共享读模型查询接口
- `storage` 观测接口
- `retrieval-runtime` 观测接口

要求：

- 每个数据源独立超时
- 每个数据源独立错误处理
- 每个数据源独立健康检查

### 5.3 实现三类主页面

至少实现这些页面：

- 记忆目录页
- 运行轨迹页
- 指标看板页

### 5.4 实现记忆目录页

页面至少要支持：

- 按正式视图模式切换：
  - `workspace_only`
  - `workspace_plus_global`
- 按 `memory_type`
- 按 `scope`
- 按 `status`
- 按更新时间范围

页面至少要展示：

- 基本字段
- 状态字段
- 来源字段
- 时间字段

### 5.5 实现运行轨迹页

页面主入口按 `turn_id` 查看，并能展示：

- Turn
- Trigger
- Recall
- Injection
- WriteBack

要让人一眼看明白：

- 为什么触发或没触发
- 为什么查空
- 为什么注入或没注入
- 为什么写回成功或失败

### 5.6 实现指标看板页

至少要展示下面两侧指标：

- `retrieval-runtime` 侧运行指标
- `storage` 侧写入与治理指标

### 5.7 实现健康状态面板

需要单独展示：

- 本服务自身 `liveness`
- 本服务自身 `readiness`
- 外部 `dependencies`

## 6. 这层的输出物

你最终要交付的内容至少包括：

- `services/visualization` 的可运行项目骨架
- 页面路由和布局
- 数据源 client 和聚合层
- 目录页、轨迹页、看板页
- 健康状态面板
- 基础测试

## 7. 开发约束

你必须遵守下面这些约束：

- 不直接引用 `storage` 和 `retrieval-runtime` 的内部代码
- 不直接读取私有表或私有运行状态
- 任意上游服务没启动时，页面层仍然可以启动
- 每个数据源失败时，只影响对应区域，不允许整站不可用
- 页面展示必须解释问题，不要只堆原始 JSON

## 8. 验收标准

完成后，至少要满足下面这些验收项：

### 8.1 工程层

- `services/visualization` 可以单独安装依赖并启动
- 即使 `storage` 或 `retrieval-runtime` 未启动，本服务仍能启动
- 配置缺失时返回明确错误

### 8.2 页面层

- 记忆目录页可用
- 运行轨迹页可用
- 指标看板页可用
- 健康状态面板可用

### 8.3 数据层

- 每个数据源都有独立 client
- 每个数据源都有独立超时和错误处理
- 页面不依赖上游私有实现

### 8.4 解释层

- 记忆目录页能解释“当前有什么记忆”
- 运行轨迹页能解释“这一轮发生了什么”
- 指标看板页能解释“问题偏向策略、数据还是依赖”

### 8.5 容错层

- 单个数据源失败时，只影响对应模块区域
- 页面能明确显示“数据源不可用”而不是空白
- 本服务自身健康状态和依赖状态能区分显示

### 8.6 测试层

- 至少覆盖页面关键数据转换
- 至少覆盖空态和错误态
- 至少覆盖数据源失败时的降级显示

## 9. 开发完成时怎么自检

请按这个顺序自检：

1. 页面是否只消费正式接口和共享读模型
2. 三类主页面是否都能回答对应排查问题
3. 数据源失败时是否局部降级
4. 健康状态是否区分自身和依赖
5. 测试是否覆盖空态、错误态和数据转换
