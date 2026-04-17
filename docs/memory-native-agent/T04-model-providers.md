# T04 — 模型 provider 抽象与三实现

## 1. 目标

定义 `IModelProvider` 接口，实现三个首版 provider：

- `OpenAICompatibleProvider`（覆盖 OpenAI、DeepSeek、GLM、Moonshot、任何 OpenAI 兼容端点）
- `AnthropicProvider`
- `OllamaProvider`（本地）

对上层 `runner` 暴露统一的流式对话 + 工具调用能力，对配置文件暴露一致的切换方式。

## 2. 前置依赖

- T01 完成。

## 3. 交付物

### 3.1 文件清单

```
src/providers/
├── index.ts                    # 导出接口与工厂
├── types.ts                    # IModelProvider、ChatMessage、ToolSchema、ChatChunk
├── provider-factory.ts         # 按 config 选择 provider
├── openai-compatible.ts
├── anthropic.ts
├── ollama.ts
└── __tests__/
    ├── openai-compatible.test.ts
    ├── anthropic.test.ts
    └── ollama.test.ts
```

### 3.2 接口定义（要点）

```ts
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: JSONSchema;   // JSON Schema
}

export type ChatChunk =
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "end"; finish_reason: "stop" | "tool_use" | "length" | "error"; usage: Usage };

export interface Usage {
  prompt_tokens: number;        // 本次调用输入 token
  completion_tokens: number;    // 本次调用输出 token
  // provider 未上报时填 0；不要用 null/undefined，以便 store 统计
}

export interface IModelProvider {
  id(): string;                          // "openai-compatible" / "anthropic" / "ollama"
  model(): string;                       // 当前模型标识
  chat(req: {
    messages: ChatMessage[];
    tools?: ToolSchema[];
    temperature?: number;
    max_tokens?: number;
    signal?: AbortSignal;
  }): AsyncIterable<ChatChunk>;
}
```

### 3.3 三个 provider 实现要点

#### OpenAICompatibleProvider

- 使用 `/v1/chat/completions` 流式（SSE）
- 支持 `tools` + `tool_choice: "auto"`
- 字段 `stream: true`，解析 `choices[0].delta.content` 与 `delta.tool_calls`
- 配置项：`base_url`、`api_key`、`model`、`organization?`

#### AnthropicProvider

- 使用 `POST /v1/messages` 流式
- 把 OpenAI 风格的 `ChatMessage` 转成 Anthropic 的 `messages` + 独立 `system` 参数
- 把 `tools` 映射为 Anthropic tool schema
- 解析 SSE 事件 `content_block_delta` / `tool_use` / `message_stop`

#### OllamaProvider

- 使用 `POST /api/chat` 流式 NDJSON
- 工具调用 Ollama 0.4+ 的 `tools` 字段，若模型不支持则 fallback 到纯文本并在 runner 里标注
- 配置项：`base_url`（默认 `http://127.0.0.1:11434`）、`model`、`keep_alive?`

### 3.4 统一能力差异兜底

把**非共通能力**全部隐藏在 provider 内部：

- 不支持工具调用的模型：`chat` 正常返回文本，永不产生 `tool_call` chunk；runner 收到纯文本即可。
- 流式失败时 provider 负责降级为一次性非流式请求，再通过 `ChatChunk` 逐段 yield。

### 3.4.0 重试与限流处理

| 场景 | 处理 |
| :--- | :--- |
| HTTP 429（限流） | 读 `Retry-After` 头（无则默认 1s）退避一次；重试仍 429 → 抛 `ProviderRateLimitedError`（→ WS code `provider_rate_limited`） |
| HTTP 5xx | 以 500ms / 1s 两次指数退避；仍失败抛 `ProviderUnavailableError` |
| HTTP 401 / 403 | **不重试**，直接抛 `ProviderAuthError`（→ WS code `provider_auth_failed`） |
| 连接超时（首字节） | 默认 30s；超时抛 `ProviderTimeoutError`（→ WS code `provider_timeout`） |
| 流中途错误 | 不重试（已有部分输出）；向调用方抛 `ProviderStreamError`（→ WS code `provider_stream_error`），由 T12 §9.5 的顺序规则兜底 |

重试仅覆盖"首字节前"的阶段；一旦 chunk 开始流出就不再重试。常量放 `src/shared/constants.ts`，env 可覆盖（`MNA_PROVIDER_MAX_RETRIES` 默认 2、`MNA_PROVIDER_FIRST_TOKEN_TIMEOUT_MS` 默认 30000）。

### 3.4.1 统一 tool schema 与各 provider 的映射

`ToolSchema.parameters` 统一使用 **JSON Schema draft-07**。provider 内部做转换：

| Provider | 目标格式 | 字段映射 |
| :--- | :--- | :--- |
| OpenAI 兼容 | `{type:"function", function:{name, description, parameters}}` | `parameters` 直接塞 JSON Schema |
| Anthropic | `{name, description, input_schema}` | `input_schema` 放 JSON Schema；`description` 合并进来 |
| Ollama | `{type:"function", function:{name, description, parameters}}` | 同 OpenAI（Ollama 0.4+ 用 OpenAI 兼容格式）|

`tool_choice` 首版只暴露 `"auto"`，不开放 `"required"` / `"none"` / 指定工具。

### 3.4.2 SSE 流式解析规则

所有 provider 的 HTTP 流响应**必须做 line buffering**，不能假设每次 chunk 恰好是一行：

```ts
let buffer = "";
for await (const chunk of response.body) {
  buffer += decoder.decode(chunk, { stream: true });
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";         // 最后一段可能不完整，留到下次
  for (const line of lines) {
    // 处理完整行
  }
}
```

忽略这一步会导致生产环境随机出现"半个 JSON 解析失败"错误。

### 3.5 工厂

```ts
createProvider(config: ProviderConfig): IModelProvider
```

`ProviderConfig`（由 T09 config 模块提供）形如：

```yaml
provider:
  kind: openai-compatible   # openai-compatible | anthropic | ollama
  model: deepseek-chat
  base_url: https://api.deepseek.com
  api_key_env: DEEPSEEK_API_KEY
```

`api_key_env` 指定环境变量名，实际 api key 从 `process.env` 读取，**配置文件不直接存密钥**。

## 4. 实施步骤

1. 写 `types.ts`：所有类型先定义，工厂签名确定。
2. 先实现 `OpenAICompatibleProvider`：最简单、覆盖最多兼容端点。
3. 跑通流式 text_delta + tool_call（用 mock server 或 record/replay 做测试）。
4. 复用 text_delta 解析结构，实现 `AnthropicProvider`（map 层重点覆盖 system 消息拆分）。
5. 实现 `OllamaProvider`：NDJSON 解析 + 工具调用字段。
6. 给每个 provider 一个集成测试（mock HTTP 服务），验证流式 + 工具调用 + 非流式降级。

## 5. 验收标准

- 三个 provider 各至少 3 条测试用例通过：
  - 纯文本流式
  - 工具调用
  - HTTP 5xx / 网络错误
- 切换 provider 只通过 config 文件改 `kind` + `model` 即可，runner 代码不变。
- 单个 provider 文件 < 400 行；没有内部互相 import。

## 6. 相关契约

- `docs/architecture-independence.md` 第 4.1 节：外部共享依赖约定（embedding 走 storage/runtime，不归 agent 管）
- 本模块是**新增外部依赖**，按"不在三服务之间共享"原则，每个 provider 在 agent 进程内独立配置

## 7. 不在范围内

- Function calling 的多轮协议迭代（交给 T07 runner 处理循环）
- 提示词模板 / system prompt 管理（runner 层决定）
- provider 自己的缓存（不做）
- `tool_call.arguments` 的 chunk 级流式（见 T12 §9.4：首版 provider 内部 buffer，仅 emit 完整 call）
