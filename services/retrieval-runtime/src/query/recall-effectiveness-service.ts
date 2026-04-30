import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type { RecallEffectivenessEvaluator, RecallEffectivenessInputMemory } from "../memory-orchestrator/index.js";
import type { RuntimeRepository } from "../observability/runtime-repository.js";
import type { FinalizeTurnInput } from "../shared/types.js";
import { nowIso } from "../shared/utils.js";
import type { WritebackEngine } from "../writeback/writeback-engine.js";

const MEMORY_EFFECTIVENESS_PROMPT_VERSION = "memory-recall-effectiveness-v1";
const MEMORY_PLAN_SCHEMA_VERSION = "memory-plan-schema-v1";
const INJECTION_EVALUATION_TTL_MS = 30 * 60 * 1000;

type RecallEffectivenessServiceOptions = {
  dependencyGuard: DependencyGuard;
  repository: Pick<RuntimeRepository, "recordMemoryPlanRun">;
  writebackEngine: Pick<WritebackEngine, "patchRecord">;
  embeddingTimeoutMs: number;
  memoryLlmTimeoutMs: number;
  evaluator?: RecallEffectivenessEvaluator;
};

export class RecallEffectivenessService {
  private readonly recentInjectionContexts = new Map<string, {
    memories: RecallEffectivenessInputMemory[];
    created_at: number;
  }>();

  constructor(private readonly options: RecallEffectivenessServiceOptions) {}

  storeInjectionContext(
    context: Pick<FinalizeTurnInput, "session_id" | "turn_id">,
    records: Array<{ id: string; summary: string; importance: number }>,
    traceIdOverride?: string,
  ) {
    this.cleanupExpiredInjectionContexts();
    const key = this.getInjectionContextKey(
      context.session_id,
      context.turn_id,
      traceIdOverride,
    );
    if (!key || records.length === 0) {
      return;
    }
    this.recentInjectionContexts.set(key, {
      memories: records.map((record) => ({
        record_id: record.id,
        summary: record.summary,
        importance: record.importance,
      })),
      created_at: Date.now(),
    });
  }

  async evaluateIfNeeded(
    input: Pick<FinalizeTurnInput, "session_id" | "turn_id" | "assistant_output" | "tool_results_summary">,
    traceId: string,
  ): Promise<void> {
    const evaluator = this.options.evaluator;
    if (!evaluator) {
      return;
    }

    this.cleanupExpiredInjectionContexts();
    const key = this.getInjectionContextKey(input.session_id, input.turn_id, traceId);
    if (!key) {
      return;
    }
    const context = this.recentInjectionContexts.get(key);
    if (!context || context.memories.length === 0) {
      return;
    }

    const startedAt = Date.now();
    const planResult = await this.options.dependencyGuard.run(
      "memory_llm",
      this.options.memoryLlmTimeoutMs,
      () =>
        evaluator.evaluate({
          injected_memories: context.memories,
          assistant_output: input.assistant_output,
          tool_behavior_summary: buildToolBehaviorSummary(input.tool_results_summary),
        }),
    );

    if (!planResult.ok || !planResult.value) {
      await this.options.repository.recordMemoryPlanRun({
        trace_id: traceId,
        phase: "after_response",
        plan_kind: "memory_effectiveness_plan",
        input_summary: summarizeText(`memories=${context.memories.length}`),
        output_summary: summarizeText(`fallback=${planResult.error?.code ?? "memory_llm_unavailable"}`),
        prompt_version: MEMORY_EFFECTIVENESS_PROMPT_VERSION,
        schema_version: MEMORY_PLAN_SCHEMA_VERSION,
        degraded: true,
        degradation_reason: planResult.error?.code ?? "memory_llm_unavailable",
        result_state: "fallback",
        duration_ms: Date.now() - startedAt,
        created_at: nowIso(),
      });
      return;
    }

    await this.options.repository.recordMemoryPlanRun({
      trace_id: traceId,
      phase: "after_response",
      plan_kind: "memory_effectiveness_plan",
      input_summary: summarizeText(`memories=${context.memories.length}`),
      output_summary: summarizeText(
        `evaluations=${planResult.value.evaluations.length}; used=${planResult.value.evaluations.filter((item) => item.was_used).length}`,
      ),
      prompt_version: MEMORY_EFFECTIVENESS_PROMPT_VERSION,
      schema_version: MEMORY_PLAN_SCHEMA_VERSION,
      degraded: false,
      result_state: planResult.value.evaluations.length > 0 ? "planned" : "skipped",
      duration_ms: Date.now() - startedAt,
      created_at: nowIso(),
    });

    await Promise.all(planResult.value.evaluations.map(async (evaluation) => {
      if (evaluation.suggested_importance_adjustment === 0) {
        return;
      }
      const current = context.memories.find((memory) => memory.record_id === evaluation.record_id);
      if (!current) {
        return;
      }
      const nextImportance = Math.max(1, Math.min(5, current.importance + evaluation.suggested_importance_adjustment));
      await this.options.dependencyGuard.run(
        "storage_writeback",
        this.options.embeddingTimeoutMs,
        () =>
          this.options.writebackEngine.patchRecord(evaluation.record_id, {
            importance: nextImportance,
            ...(evaluation.was_used ? { last_used_at: nowIso() } : {}),
            actor: {
              actor_type: "system",
              actor_id: "retrieval-runtime",
            },
            reason: evaluation.reason,
          }),
      );
    }));

    this.recentInjectionContexts.delete(key);
  }

  private cleanupExpiredInjectionContexts() {
    const now = Date.now();
    for (const [key, value] of this.recentInjectionContexts.entries()) {
      if (now - value.created_at > INJECTION_EVALUATION_TTL_MS) {
        this.recentInjectionContexts.delete(key);
      }
    }
  }

  private getInjectionContextKey(
    sessionId: string,
    turnId?: string,
    traceId?: string,
  ) {
    if (turnId) {
      return `${sessionId}:${turnId}`;
    }
    if (traceId) {
      return `${sessionId}:${traceId}`;
    }
    return undefined;
  }
}

function summarizeText(value: string | undefined, maxLength = 220) {
  if (!value) {
    return "";
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

function buildToolBehaviorSummary(toolResultsSummary?: string): string | undefined {
  const normalized = summarizeText(toolResultsSummary, 1_000);
  if (!normalized) {
    return undefined;
  }

  const indicators = new Set<string>();
  const patterns = [
    /(?:indentation|indent|spaces|space|tab|format)\s*[:=]\s*[\w:-]+/gi,
    /(?:language|lang|locale)\s*[:=]\s*[\w-]+/gi,
    /(?:import|require|from)\s+['"][^'"]+['"]/gi,
    /(?:created|updated|modified|wrote|formatted|installed|deployed)\s+[^;\n]+/gi,
    /(?:缩进|空格|制表符|格式化|语言|中文|英文|导入|安装|部署)[^;\n。.!]*/gi,
  ];

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const value = match[0]?.trim();
      if (value) {
        indicators.add(value);
      }
    }
  }

  if (indicators.size === 0) {
    return undefined;
  }

  return `工具行为摘要: ${[...indicators].slice(0, 8).join("; ")}`;
}
