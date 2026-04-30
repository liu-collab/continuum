import { scopePlanReason } from "../shared/messages.js";
import type { MemoryMode, MemoryType, RuntimePhase, ScopeType } from "../shared/types.js";
import {
  matchesContextDependentShortReference,
  matchesHistoryReference,
  normalizeText,
} from "../shared/utils.js";

export interface LiteRuleTriggerContext {
  phase: RuntimePhase;
  current_input: string;
  recent_context_summary?: string;
  workspace_id: string;
  user_id: string;
  session_id: string;
  task_id?: string;
  memory_mode?: MemoryMode;
}

export interface LiteRuleTriggerDecision {
  hit: boolean;
  trigger_type:
    | "phase"
    | "history_reference"
    | "context_dependent_short_reference"
    | "no_trigger";
  trigger_reason: string;
  requested_memory_types: MemoryType[];
  requested_scopes: ScopeType[];
  scope_reason: string;
  importance_threshold: number;
  query: string;
  allow_broad_fallback: boolean;
}

const ALL_MEMORY_TYPES: MemoryType[] = ["fact", "preference", "task_state", "episodic"];
const SESSION_START_TYPES: MemoryType[] = ["fact", "preference", "task_state"];
const TASK_TYPES: MemoryType[] = ["task_state", "fact", "preference"];
const SESSION_START_IMPORTANCE = 4;
const DEFAULT_IMPORTANCE = 3;

export function decideLiteRuleTrigger(context: LiteRuleTriggerContext): LiteRuleTriggerDecision {
  const memoryMode = context.memory_mode ?? "workspace_plus_global";

  switch (context.phase) {
    case "session_start":
      return buildDecision({
        context,
        memoryMode,
        triggerType: "phase",
        triggerReason: "会话启动阶段恢复工作区和用户的高重要性记忆。",
        scopes: ["workspace", "user"],
        memoryTypes: SESSION_START_TYPES,
        importanceThreshold: SESSION_START_IMPORTANCE,
        query: "",
        allowBroadFallback: false,
      });

    case "task_start":
    case "task_switch":
      if (!context.task_id) {
        return noTrigger(context, "任务阶段缺少 task_id，跳过任务记忆召回。");
      }

      return buildDecision({
        context,
        memoryMode,
        triggerType: "phase",
        triggerReason: "任务开始或切换阶段恢复任务状态和项目约定。",
        scopes: ["task", "workspace"],
        memoryTypes: TASK_TYPES,
        importanceThreshold: DEFAULT_IMPORTANCE,
        query: buildRuleQuery(context),
        allowBroadFallback: true,
      });

    case "before_response": {
      const currentInput = normalizeText(context.current_input);
      const historyHit = matchesHistoryReference(currentInput);
      const shortReferenceHit = matchesContextDependentShortReference(currentInput);
      if (!historyHit && !shortReferenceHit) {
        return noTrigger(context, "当前输入没有明显的历史引用线索。");
      }

      return buildDecision({
        context,
        memoryMode,
        triggerType: historyHit ? "history_reference" : "context_dependent_short_reference",
        triggerReason: historyHit
          ? "当前输入明确引用历史上下文或既有约定。"
          : "当前输入较短且依赖已有上下文。",
        scopes: ["workspace", "task", "session", "user"],
        memoryTypes: ALL_MEMORY_TYPES,
        importanceThreshold: DEFAULT_IMPORTANCE,
        query: buildRuleQuery(context),
        allowBroadFallback: true,
      });
    }

    case "after_response":
      return noTrigger(context, "响应后阶段不执行记忆召回。");

    case "before_plan":
      return noTrigger(context, "精简模式规则触发器不在 before_plan 阶段召回。");
  }
}

function buildDecision(input: {
  context: LiteRuleTriggerContext;
  memoryMode: MemoryMode;
  triggerType: LiteRuleTriggerDecision["trigger_type"];
  triggerReason: string;
  scopes: ScopeType[];
  memoryTypes: MemoryType[];
  importanceThreshold: number;
  query: string;
  allowBroadFallback: boolean;
}): LiteRuleTriggerDecision {
  const requestedScopes = normalizeScopes(input.scopes, input.context, input.memoryMode);
  return {
    hit: requestedScopes.length > 0 && input.memoryTypes.length > 0,
    trigger_type: input.triggerType,
    trigger_reason: input.triggerReason,
    requested_memory_types: input.memoryTypes,
    requested_scopes: requestedScopes,
    scope_reason: scopePlanReason(input.context.phase, input.memoryMode, Boolean(input.context.task_id)),
    importance_threshold: input.importanceThreshold,
    query: input.query,
    allow_broad_fallback: input.allowBroadFallback,
  };
}

function noTrigger(context: LiteRuleTriggerContext, reason: string): LiteRuleTriggerDecision {
  const memoryMode = context.memory_mode ?? "workspace_plus_global";
  return {
    hit: false,
    trigger_type: "no_trigger",
    trigger_reason: reason,
    requested_memory_types: [],
    requested_scopes: [],
    scope_reason: scopePlanReason(context.phase, memoryMode, Boolean(context.task_id)),
    importance_threshold: DEFAULT_IMPORTANCE,
    query: "",
    allow_broad_fallback: false,
  };
}

function normalizeScopes(
  scopes: ScopeType[],
  context: LiteRuleTriggerContext,
  memoryMode: MemoryMode,
): ScopeType[] {
  const normalized: ScopeType[] = [];
  for (const scope of scopes) {
    if (scope === "user" && memoryMode !== "workspace_plus_global") {
      continue;
    }
    if (scope === "task" && !context.task_id) {
      continue;
    }
    if (scope === "session" && !context.session_id) {
      continue;
    }
    if (!normalized.includes(scope)) {
      normalized.push(scope);
    }
  }
  return normalized;
}

function buildRuleQuery(context: LiteRuleTriggerContext): string {
  return normalizeText([
    context.current_input,
    context.recent_context_summary ?? "",
  ].filter(Boolean).join(" "));
}
