import type { MemoryType, RuntimePhase, TriggerDecision } from "./types.js";

export const memoryTypeLabels: Record<MemoryType, string> = {
  fact_preference: "偏好与约束",
  task_state: "任务状态",
  episodic: "历史片段",
};

export const runtimeMessages = {
  noMatchedMemory: "这次触发没有命中可用记忆。",
  historyReferenceReason: "当前输入明确引用了历史上下文或既有偏好。",
  semanticDegradedReason: "语义兜底因依赖异常降级，本轮不执行召回。",
  semanticFallbackReason: "语义相似度超过兜底阈值，已触发记忆召回。",
  shortInputSkipReason: "当前输入过短，且没有明显的历史引用线索。",
  noTriggerReason: "没有命中显式触发条件，语义兜底也未达到阈值。",
  afterResponseReason: "响应后阶段只执行写回检查，不做记忆召回。",
} as const;

const mandatoryPhaseReasons: Record<Exclude<RuntimePhase, "before_response" | "after_response">, string> = {
  session_start: "会话启动阶段需要恢复基础上下文。",
  task_start: "任务开始阶段需要恢复相关任务记忆。",
  task_switch: "任务切换阶段需要恢复新任务上下文。",
  before_plan: "规划前阶段需要补充约束和任务状态。",
};

export function phaseTriggerReason(phase: RuntimePhase): string {
  if (phase === "before_response") {
    return "回应前阶段已进入注入判定流程。";
  }
  if (phase === "after_response") {
    return runtimeMessages.afterResponseReason;
  }
  return mandatoryPhaseReasons[phase];
}

export function scopePlanReason(
  phase: RuntimePhase,
  memoryMode: "workspace_only" | "workspace_plus_global",
  hasTask: boolean,
): string {
  switch (phase) {
    case "session_start":
      return memoryMode === "workspace_plus_global"
        ? "会话启动时读取工作区记忆，并补充全局用户记忆。"
        : "会话启动时仅读取当前工作区记忆。";
    case "task_start":
    case "task_switch":
    case "before_plan":
      return memoryMode === "workspace_plus_global"
        ? hasTask
          ? "本阶段会读取工作区、任务和全局用户记忆。"
          : "本阶段会读取工作区和全局用户记忆。"
        : hasTask
          ? "本阶段会读取工作区和任务记忆，不包含全局用户记忆。"
          : "本阶段仅读取工作区记忆。";
    case "before_response":
      return memoryMode === "workspace_plus_global"
        ? hasTask
          ? "回应前可综合使用工作区、任务、会话和全局用户记忆。"
          : "回应前可综合使用工作区、会话和全局用户记忆。"
        : hasTask
          ? "回应前可综合使用工作区、任务和会话记忆。"
          : "回应前可综合使用工作区和会话记忆。";
    case "after_response":
      return "响应后阶段不执行召回。";
  }
}

export function injectionHintLabel(decision: TriggerDecision): string {
  if (decision.requested_memory_types.includes("task_state")) {
    return "优先帮助模型延续当前任务。";
  }
  if (decision.requested_memory_types.includes("fact_preference")) {
    return "优先提醒稳定偏好与背景约束。";
  }
  return "优先补充历史片段作为参考。";
}
