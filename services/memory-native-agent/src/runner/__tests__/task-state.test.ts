import { describe, expect, it } from "vitest";

import { createTaskState, findClosestTask, upsertRecentTask } from "../task-state.js";

describe("task-state helpers", () => {
  it("finds the closest historical task when similarity is above threshold", () => {
    const tasks = [
      createTaskState("支付链路重构"),
      createTaskState("修复登录接口"),
      createTaskState("整理监控面板"),
    ];

    const matched = findClosestTask(tasks, "支付链路重构方案");

    expect(matched?.label).toBe("支付链路重构");
  });

  it("keeps recent tasks deduped and capped at ten entries", () => {
    let recentTasks = Array.from({ length: 10 }, (_, index) => createTaskState(`Task ${10 - index}`));
    const resumed = recentTasks[4];
    if (!resumed) {
      throw new Error("Expected seeded task.");
    }

    recentTasks = upsertRecentTask(recentTasks, resumed);
    recentTasks = upsertRecentTask(recentTasks, createTaskState("Task 11"));

    expect(recentTasks).toHaveLength(10);
    expect(recentTasks[0]?.id).toBeDefined();
    expect(recentTasks[0]?.label).toBe("Task 11");
    expect(recentTasks.filter((task) => task.id === resumed.id)).toHaveLength(1);
    expect(recentTasks.some((task) => task.label === "Task 1")).toBe(false);
  });
});
