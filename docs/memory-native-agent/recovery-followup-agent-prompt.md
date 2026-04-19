# recovery 自动化剩余缺口提示词

你要继续补的是 `memory-native-agent` 重启后，`/agent` 页面自动恢复连接 这一条。

当前结论：

- `runtime down -> 页面不白屏 -> 继续可用 -> 显示降级状态` 已经自动化通过
- `mna down -> 页面显示离线提示` 已经自动化通过
- `mna restart -> 页面自动恢复连接` 还没有闭环，所以验收清单目前是 `[进行中]`

你要先解决的问题：

- 为什么 `mna` 重启后，前端有时仍停在离线态，没有重新回到会话页
- 当前恢复失败时，是 `bootstrap` 没重新执行，还是 token 探活恢复后没有重新打开 session
- 是页面状态机问题，还是 `mna` 重启后的 session 恢复策略问题

建议排查顺序：

1. 先看 `/api/agent/token` 在 `mna` 重启前后返回什么
2. 再看 `useAgentWorkspace` 在离线态恢复后，是否会重新触发 `bootstrap`
3. 再看带 `sessionId` 的 `/agent/[sessionId]` 页面，在恢复后是否会重新执行 `openSession`
4. 最后确认 WebSocket 断开后，是否有可重连路径

约束条件：

- 不要改掉当前已经通过的 `runtime degrade`、`tools/MCP`、`runs` 自动化
- 不要把这条未完成项改成跳过后就算完成
- 只有在真实浏览器自动化通过后，才能把清单改成 `[自动化通过]`

完成标准：

- `services/visualization/tests/agent-e2e/agent-recovery.spec.ts` 中第二条恢复用例真实通过
- `docs/memory-native-agent/acceptance-checklist.md` 对应项从 `[进行中]` 改为 `[自动化通过]`
- 提交代码时只包含这条恢复链路相关文件
