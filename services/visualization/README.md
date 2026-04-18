# visualization 服务初始化

## 技术选型

- 语言：`TypeScript`
- 框架：`Next.js`
- UI：`React + Tailwind CSS + shadcn/ui`
- 数据请求：`TanStack Query`
- 表格：`TanStack Table`
- 图表：`ECharts`
- 校验：`Zod`

## 这样选的原因

- 这一层既要做服务端数据聚合，也要做前端交互页，`Next.js` 最合适。
- 看板、轨迹、目录页都需要较强的表格和图表能力，`TanStack Table + ECharts` 比较直接。
- `visualization` 不参与主链路，最重要的是解释清楚和独立运行，所以前端栈要稳定、页面化能力强。

## 这一层目录骨架

```text
visualization/
├── .env.example
├── public/
└── src/
    ├── app/
    ├── components/
    ├── features/
    └── lib/
```

## 当前新增约定

- `src/app/agent/_lib/`
  首版内置 `agent` 的浏览器端辅助代码统一先放这里。

- `src/app/api/agent/token/route.ts`
  只负责读取本机 `token` 文件并返回给浏览器，不代理 `mna` 主链路请求。

- `next dev` 和 `next start`
  当前默认绑定到 `127.0.0.1`，首版只支持本机访问。

## 各目录先放什么

- `src/app/`
  放页面路由和布局

- `src/components/`
  放通用组件，比如表格容器、状态卡片、空态、错误态

- `src/features/`
  按业务拆：
  - `memory-catalog`
  - `run-trace`
  - `dashboard`
  - `source-health`

- `src/lib/`
  放 API client、查询参数、DTO 转换、时间窗工具

- `public/`
  放静态资源

## 后续第一批代码

建议直接按这个顺序写：

1. 数据源健康接口 client
2. 记忆目录页
3. 运行轨迹页
4. 指标看板页
5. 数据源状态面板
6. 统一空态和错误态
