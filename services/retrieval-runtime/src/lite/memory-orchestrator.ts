import { randomUUID } from "node:crypto";

import type { FileMemorySearchQuery, FileMemoryStore } from "./file-store.js";
import { LiteMemoryFunctionHandler, type LiteMemorySearchFunctionResult } from "./search-handler.js";
import {
  type LiteRuleTriggerContext,
  type LiteRuleTriggerDecision,
  decideLiteRuleTrigger,
} from "./rule-trigger.js";
import type { LiteMemoryModelStatus } from "./memory-model-config.js";
import { getLiteMemoryModelStatus } from "./memory-model-config.js";
import type { HostKind, InjectionBlock, InjectionRecord, MemoryMode, RuntimePhase, ScopeType } from "../shared/types.js";
import { estimateTokens, normalizeText } from "../shared/utils.js";

export interface LiteRecentTurn {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export interface LitePrepareContextInput {
  host: HostKind | string;
  workspace_id: string;
  user_id: string;
  session_id: string;
  phase: RuntimePhase;
  current_input: string;
  task_id?: string;
  thread_id?: string;
  turn_id?: string;
  recent_context_summary?: string;
  recent_turns?: LiteRecentTurn[];
  memory_mode?: MemoryMode;
  injection_token_budget?: number;
  limit?: number;
}

export interface LiteMemoryFunctionCallTrace {
  name: "memory_search";
  arguments: FileMemorySearchQuery;
  result_count: number;
  returned_count: number;
}

export interface LitePrepareContextTrace {
  trace_id: string;
  host: string;
  workspace_id: string;
  user_id: string;
  session_id: string;
  task_id?: string;
  thread_id?: string;
  turn_id?: string;
  phase: RuntimePhase;
  current_input: string;
  memory_mode: MemoryMode;
  rule_trigger: LiteRuleTriggerDecision;
  memory_model_status: LiteMemoryModelStatus;
  function_calls: LiteMemoryFunctionCallTrace[];
  selected_record_ids: string[];
  injected: boolean;
  created_at: string;
}

export interface LitePrepareContextResult {
  injection_block: InjectionBlock | null;
  trace: LitePrepareContextTrace;
  trace_id: string;
  memory_model_status: LiteMemoryModelStatus;
}

export interface MemoryOrchestratorOptions {
  store: Pick<FileMemoryStore, "load" | "search" | "get">;
  memoryModelStatus?: LiteMemoryModelStatus;
  recordLimit?: number;
  tokenBudget?: number;
  traceIdFactory?: () => string;
  now?: () => string;
}

const DEFAULT_RECORD_LIMIT = 5;
const DEFAULT_TOKEN_BUDGET = 1500;

export class MemoryOrchestrator {
  private readonly recordLimit: number;
  private readonly tokenBudget: number;
  private readonly traceIdFactory: () => string;
  private readonly now: () => string;
  private readonly memoryFunctions: LiteMemoryFunctionHandler;

  constructor(private readonly options: MemoryOrchestratorOptions) {
    this.recordLimit = normalizePositiveInteger(options.recordLimit, DEFAULT_RECORD_LIMIT);
    this.tokenBudget = normalizePositiveInteger(options.tokenBudget, DEFAULT_TOKEN_BUDGET);
    this.traceIdFactory = options.traceIdFactory ?? (() => randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
    this.memoryFunctions = new LiteMemoryFunctionHandler({ store: options.store });
  }

  async prepareContext(input: LitePrepareContextInput): Promise<LitePrepareContextResult> {
    await this.options.store.load();

    const ruleContext = buildRuleContext(input);
    const decision = decideLiteRuleTrigger(ruleContext);
    const memoryModelStatus = this.options.memoryModelStatus
      ?? getLiteMemoryModelStatus({});
    const functionCalls: LiteMemoryFunctionCallTrace[] = [];

    let injectionBlock: InjectionBlock | null = null;
    if (decision.hit) {
      const searchResult = this.searchWithDecision(input, decision, functionCalls);
      injectionBlock = buildInjectionBlock({
        decision,
        searchResult,
        memoryMode: input.memory_mode ?? "workspace_plus_global",
        tokenBudget: normalizePositiveInteger(input.injection_token_budget, this.tokenBudget),
        recordLimit: normalizePositiveInteger(input.limit, this.recordLimit),
      });
    }

    const trace: LitePrepareContextTrace = {
      trace_id: this.traceIdFactory(),
      host: input.host,
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      session_id: input.session_id,
      ...(input.task_id ? { task_id: input.task_id } : {}),
      ...(input.thread_id ? { thread_id: input.thread_id } : {}),
      ...(input.turn_id ? { turn_id: input.turn_id } : {}),
      phase: input.phase,
      current_input: input.current_input,
      memory_mode: input.memory_mode ?? "workspace_plus_global",
      rule_trigger: decision,
      memory_model_status: memoryModelStatus,
      function_calls: functionCalls,
      selected_record_ids: injectionBlock?.memory_records.map((record) => record.id) ?? [],
      injected: Boolean(injectionBlock && injectionBlock.memory_records.length > 0),
      created_at: this.now(),
    };

    return {
      injection_block: injectionBlock,
      trace,
      trace_id: trace.trace_id,
      memory_model_status: memoryModelStatus,
    };
  }

  private searchWithDecision(
    input: LitePrepareContextInput,
    decision: LiteRuleTriggerDecision,
    functionCalls: LiteMemoryFunctionCallTrace[],
  ): LiteMemorySearchFunctionResult {
    const baseQuery: FileMemorySearchQuery = {
      query: decision.query,
      memory_types: decision.requested_memory_types,
      scopes: decision.requested_scopes,
      importance_min: decision.importance_threshold,
      limit: normalizePositiveInteger(input.limit, this.recordLimit),
    };
    const functionContext = {
      workspace_id: input.workspace_id,
      user_id: input.user_id,
      session_id: input.session_id,
      task_id: input.task_id,
    };

    const result = this.memoryFunctions.memorySearch(functionContext, baseQuery);
    functionCalls.push({
      name: "memory_search",
      arguments: result.effective_query,
      result_count: result.total,
      returned_count: result.records.length,
    });

    if (result.records.length > 0 || !decision.allow_broad_fallback || !decision.query) {
      return result;
    }

    const fallbackQuery = { ...baseQuery, query: "" };
    const fallbackResult = this.memoryFunctions.memorySearch(functionContext, fallbackQuery);
    functionCalls.push({
      name: "memory_search",
      arguments: fallbackResult.effective_query,
      result_count: fallbackResult.total,
      returned_count: fallbackResult.records.length,
    });
    return fallbackResult;
  }
}

function buildRuleContext(input: LitePrepareContextInput): LiteRuleTriggerContext {
  return {
    phase: input.phase,
    current_input: input.current_input,
    recent_context_summary: input.recent_context_summary ?? recentTurnsSummary(input.recent_turns),
    workspace_id: input.workspace_id,
    user_id: input.user_id,
    session_id: input.session_id,
    task_id: input.task_id,
    memory_mode: input.memory_mode,
  };
}

function buildInjectionBlock(input: {
  decision: LiteRuleTriggerDecision;
  searchResult: LiteMemorySearchFunctionResult;
  memoryMode: MemoryMode;
  tokenBudget: number;
  recordLimit: number;
}): InjectionBlock | null {
  if (input.searchResult.records.length === 0) {
    return null;
  }

  const memorySummary = buildMemorySummary(input.searchResult.records.map((record) => record.summary));
  let usedTokens = estimateTokens(memorySummary);
  const kept: InjectionRecord[] = [];
  const trimmedRecordIds: string[] = [];
  const trimReasons: string[] = [];

  for (const record of input.searchResult.records) {
    const recordTokens = estimateTokens(record.summary);
    const overRecordLimit = kept.length >= input.recordLimit;
    const overBudget = usedTokens + recordTokens > input.tokenBudget;
    if (overRecordLimit || overBudget) {
      trimmedRecordIds.push(record.id);
      trimReasons.push(overRecordLimit ? "record_limit" : "token_budget");
      continue;
    }

    kept.push({
      id: record.id,
      memory_type: record.memory_type,
      scope: record.scope,
      summary: record.summary,
      importance: record.importance,
      confidence: record.confidence,
    });
    usedTokens += recordTokens;
  }

  if (kept.length === 0) {
    return null;
  }

  return {
    injection_reason: input.decision.trigger_reason,
    memory_high: kept
      .filter((record) => record.importance >= 4)
      .slice(0, 3)
      .map((record) => record.summary),
    memory_summary: memorySummary,
    memory_records: kept,
    token_estimate: usedTokens,
    memory_mode: input.memoryMode,
    requested_scopes: input.decision.requested_scopes,
    selected_scopes: uniqueScopes(kept.map((record) => record.scope)),
    trimmed_record_ids: trimmedRecordIds,
    trim_reasons: trimReasons,
  };
}

function buildMemorySummary(summaries: string[]): string {
  return [
    "相关记忆：",
    ...summaries.slice(0, 6).map((summary) => `- ${normalizeText(summary)}`),
  ].join("\n");
}

function recentTurnsSummary(recentTurns: LiteRecentTurn[] | undefined): string | undefined {
  const summary = recentTurns
    ?.slice(-4)
    .map((turn) => `${turn.role}: ${turn.content}`)
    .join("\n");
  return summary ? normalizeText(summary) : undefined;
}

function uniqueScopes(scopes: ScopeType[]): ScopeType[] {
  return [...new Set(scopes)];
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value ?? fallback)) {
    return fallback;
  }
  return Math.max(1, Math.trunc(value ?? fallback));
}
