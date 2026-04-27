import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { TASKS, getTaskById } from "./e2e/real-user-experience/tasks.mjs";

const REAL_HOST_EVAL_SOURCE = readFileSync(
  "tests/e2e/real-user-experience/run-real-host-ab-eval.mjs",
  "utf8",
);
const REAL_HOST_RUNNER_SOURCE = readFileSync(
  "tests/e2e/real-user-experience/real-host-runner.mjs",
  "utf8",
);

describe("real user experience task suite", () => {
  it("keeps the suite shape stable", () => {
    expect(TASKS).toHaveLength(100);

    const ids = TASKS.map((task: { id: string }) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps ten variants for every scenario", () => {
    const scenarios = new Map<string, number>();
    for (const task of TASKS) {
      scenarios.set(task.scenario, (scenarios.get(task.scenario) ?? 0) + 1);
    }

    expect(scenarios).toEqual(
      new Map([
        ["global_preference", 10],
        ["workspace_convention", 10],
        ["task_continuation", 10],
        ["global_vs_workspace_conflict", 10],
        ["task_switch_isolation", 10],
        ["stale_memory", 10],
        ["correction_recovery", 10],
        ["irrelevant_no_memory", 10],
        ["multi_turn_tool_task", 10],
        ["writeback_quality", 10],
      ]),
    );
  });

  it("keeps memory-use expectations aligned with seed data", () => {
    for (const task of TASKS) {
      if (task.expected.should_writeback) {
        expect(task.seed_memories).toHaveLength(0);
      } else {
        expect(task.seed_memories.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps workspace test-command coverage on the current convention", () => {
    const task = getTaskById("ux-017");

    expect(task?.scenario).toBe("workspace_convention");
    expect(task?.title).toBe("测试命令");
    expect(task?.seed_memories[0]?.summary).toContain("Vitest");
    expect(task?.seed_memories[0]?.summary).toContain(".mjs");
    expect(task?.user_input).toBe("这个新模块要接测试命令，别破坏现在约定。");
  });

  it("keeps real-host eval seeding before running hosts", () => {
    expect(REAL_HOST_EVAL_SOURCE).toContain("seedTaskMemories");
    expect(REAL_HOST_EVAL_SOURCE).toContain("write-back-candidates");
    expect(REAL_HOST_EVAL_SOURCE).toContain("write-projection-status");
    expect(REAL_HOST_EVAL_SOURCE).toContain("--seed-only");
  });

  it("keeps Codex B group free from workspace seed-memory bypass", () => {
    const codexWorkspaceStart = REAL_HOST_RUNNER_SOURCE.indexOf(
      "function seedCodexWorkspace",
    );
    const codexWorkspaceEnd = REAL_HOST_RUNNER_SOURCE.indexOf(
      "function extractCodexTraceId",
      codexWorkspaceStart,
    );
    const codexWorkspaceSource = REAL_HOST_RUNNER_SOURCE.slice(
      codexWorkspaceStart,
      codexWorkspaceEnd,
    );

    expect(codexWorkspaceSource).toContain("buildCodexMemoryInstructions()");
    expect(codexWorkspaceSource).not.toContain("buildSeedMemoryBlock(task)");
  });
});
