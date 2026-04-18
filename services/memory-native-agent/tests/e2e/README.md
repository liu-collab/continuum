# memory-native-agent e2e

这里保留 `T10` 的端到端验收资产入口。

当前阶段已经完成：

- `setup.ts`：测试期真实装配 `mna + retrieval-runtime + storage + provider stub`
- `happy-path.e2e.test.ts`
- `degrade-runtime-down.e2e.test.ts`
- `degrade-storage-down.e2e.test.ts`
- `memory-mode-switch.e2e.test.ts`
- `governance-roundtrip.e2e.test.ts`

当前阶段还没有补齐：

- Playwright UI e2e 的本机实跑验收（当前缺浏览器安装）
- record/replay provider 驱动的端到端 fixture

后续继续补时，按 `docs/memory-native-agent/T10-e2e-acceptance.md` 的场景清单推进即可。
