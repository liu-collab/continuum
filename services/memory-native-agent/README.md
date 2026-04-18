# memory-native-agent

这是 `memory-native-agent`（自主记忆 agent 宿主）的首版服务目录。

当前这一步只完成工程骨架和最小 HTTP 服务，用来承接后续 `memory-client`、`runner`、`providers`、`tools` 和 `http api` 开发。

## 本地启动

先安装依赖：

```bash
npm install
```

开发模式：

```bash
npm run dev
```

直接启动：

```bash
node bin/mna-server.mjs
```

默认监听 `127.0.0.1:4193`，可用 `MNA_HOST`、`MNA_PORT` 覆盖。

## 健康检查

启动后访问：

```bash
curl http://127.0.0.1:4193/healthz
```

当前返回最小结构：

```json
{
  "status": "ok",
  "version": "0.1.0",
  "dependencies": {
    "retrieval_runtime": "unknown"
  }
}
```

## 测试

```bash
npm run check
npm run build
npm test
```
