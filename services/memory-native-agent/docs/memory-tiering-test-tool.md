# memory-tiering test tool

这套工具用于直接验证运行中的 `memory-native-agent` 是否真的在某些轮次注入了：

- `memory_high`
- `memory_summary`

它会自动：

1. 创建一个新会话
2. 按内置多轮提示词顺序发送消息
3. 每轮读取 `GET /v1/agent/turns/:turnId/dispatched-messages`
4. 汇总 `prompt_segments`
5. 输出每轮是否命中预期

## 默认场景

默认内置场景会覆盖三类情况：

1. 写入长期偏好，但本轮不要求召回
2. 显式引用历史偏好，要求出现 `memory_high + memory_summary`
3. 中性问题作为对照，要求不要出现记忆注入

## 用法

在 `services/memory-native-agent` 目录下执行：

```bash
npm run memory:tiering
```

如果要把结果落盘：

```bash
npm run memory:tiering -- --report-file ../../.tmp/memory-tiering-report.json
```

如果当前模型响应偏慢，可以放宽单轮等待时间：

```bash
npm run memory:tiering -- --turn-timeout-ms 30000
```

如果要显式指定连接地址或 token：

```bash
npm run memory:tiering -- --base-url http://127.0.0.1:4193 --token-path C:/Users/Administrator/.continuum/managed/mna/token.txt
```

如果要指定 workspace：

```bash
npm run memory:tiering -- --workspace-id 507d735b-6860-5aa7-b90a-996d29f6f699
```

## 自定义场景

也可以传一个自定义 `scenario-file`：

```json
{
  "id": "custom-memory-check",
  "label": "自定义记忆检查",
  "description": "验证某一组提示词是否触发高优先记忆注入",
  "turns": [
    {
      "id": "remember",
      "label": "写入偏好",
      "text": "以后默认用中文回答，除非我明确要求英文。这是长期偏好。"
    },
    {
      "id": "recall",
      "label": "显式引用",
      "text": "按照我之前的默认偏好回答。",
      "expectation": {
        "requireKinds": ["memory_high", "memory_summary"],
        "minHighRecordCount": 1
      }
    }
  ]
}
```

运行方式：

```bash
npm run memory:tiering -- --scenario-file ./my-scenario.json
```

## 输出怎么看

每轮都会输出：

- `segments`
- `phases`
- `memory_high records`
- `memory_summary segments`
- `PASS / FAIL`

如果某一轮没有完成，还会额外给出：

- `执行失败: ...`

这样可以区分：

1. 这轮真的没有触发召回
2. 这轮本身就没有正常跑完
