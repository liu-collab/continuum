# recovery 自动化收口归档

这条收口已经完成，不再作为剩余缺口。

当前结论：

- `runtime down -> 页面不白屏 -> 继续可用 -> 显示降级状态` 已自动化通过
- `mna down -> 页面显示离线提示` 已自动化通过
- `mna restart -> 页面自动恢复连接` 已自动化通过

对应结果：

- `services/visualization/tests/agent-e2e/agent-recovery.spec.ts` 两条恢复用例已真实通过
- `docs/memory-native-agent/acceptance-checklist.md` 对应项已改为 `[自动化通过]`

后续如果再次出现回归，直接以当前通过用例为基线排查，不再沿用这份“剩余缺口”提示词。
