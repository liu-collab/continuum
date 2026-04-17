import type { AppConfig } from "../config.js";
import type { DependencyGuard } from "../dependency/dependency-guard.js";
import type { EmbeddingsClient } from "../query/embeddings-client.js";
import type { ReadModelRepository } from "../query/read-model-repository.js";
import type { MemoryMode, MemoryType, ScopeType, TriggerContext, TriggerDecision } from "../shared/types.js";
import type { Logger } from "pino";
import { normalizeText } from "../shared/utils.js";

const HISTORY_PATTERNS = ["上次", "之前", "你还记得", "我一般", "偏好", "上回", "last time", "previously"];

function requestedTypesByPhase(phase: TriggerContext["phase"]): MemoryType[] {
  switch (phase) {
    case "session_start":
      return ["fact_preference", "task_state"];
    case "task_start":
    case "task_switch":
      return ["task_state", "episodic", "fact_preference"];
    case "before_plan":
      return ["fact_preference", "task_state"];
    case "before_response":
      return ["fact_preference", "task_state", "episodic"];
    case "after_response":
      return [];
  }
}

function dedupeScopes(scopes: ScopeType[]): ScopeType[] {
  return [...new Set(scopes)];
}

function scopePlanByPhase(
  phase: TriggerContext["phase"],
  hasTask: boolean,
  memoryMode: MemoryMode,
): { scopes: ScopeType[]; reason: string } {
  switch (phase) {
    case "session_start":
      return {
        scopes: memoryMode === "workspace_plus_global" ? ["workspace", "user"] : ["workspace"],
        reason:
          memoryMode === "workspace_plus_global"
            ? "session_start restores workspace memory plus global user memory"
            : "session_start is limited to workspace memory in workspace_only mode",
      };
    case "task_start":
    case "task_switch":
    case "before_plan":
      return {
        scopes: dedupeScopes([
          "workspace",
          ...(hasTask ? ["task" as const] : []),
          ...(memoryMode === "workspace_plus_global" ? ["user" as const] : []),
        ]),
        reason:
          memoryMode === "workspace_plus_global"
            ? `${phase} restores workspace, task, and global user memory`
            : `${phase} restores workspace memory and task memory without global user memory`,
      };
    case "before_response":
      return {
        scopes: dedupeScopes([
          "workspace",
          ...(hasTask ? ["task" as const] : []),
          "session",
          ...(memoryMode === "workspace_plus_global" ? ["user" as const] : []),
        ]),
        reason:
          memoryMode === "workspace_plus_global"
            ? "before_response can use workspace, task, session, and global user memory"
            : "before_response can use workspace, task, and session memory only",
      };
    case "after_response":
      return {
        scopes: [],
        reason: "after_response does not perform recall",
      };
  }
}

function shouldSkipForShortInput(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.length < 8 && !HISTORY_PATTERNS.some((pattern) => normalized.toLowerCase().includes(pattern.toLowerCase()));
}

export class TriggerEngine {
  private readonly cooldown = new Map<string, { input: string; expires_at: number }>();

  constructor(
    private readonly config: AppConfig,
    private readonly embeddingsClient: EmbeddingsClient,
    private readonly readModelRepository: ReadModelRepository,
    private readonly dependencyGuard: DependencyGuard,
    private readonly logger: Logger,
  ) {}

  async decide(context: TriggerContext): Promise<TriggerDecision> {
    const memoryMode = context.memory_mode ?? "workspace_plus_global";
    const scopePlan = scopePlanByPhase(context.phase, Boolean(context.task_id), memoryMode);

    if (context.phase === "after_response") {
      return {
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: "after_response only runs writeback inspection",
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: [],
        scope_reason: scopePlan.reason,
        importance_threshold: 3,
        cooldown_applied: false,
      };
    }

    const normalizedInput = normalizeText(context.current_input).toLowerCase();
    const cooldownKey = `${context.session_id}:${context.phase}`;
    const cooldownEntry = this.cooldown.get(cooldownKey);
    const cooldownApplied = Boolean(cooldownEntry && cooldownEntry.expires_at > Date.now() && cooldownEntry.input === normalizedInput);

    if (cooldownApplied) {
      return {
        hit: false,
        trigger_type: "cooldown_skip",
        trigger_reason: "recent recall already covered the same topic within cooldown window",
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold: 3,
        cooldown_applied: true,
      };
    }

    const requestedMemoryTypes = requestedTypesByPhase(context.phase);

    if (context.phase !== "before_response") {
      this.recordCooldown(cooldownKey, normalizedInput);
      return {
        hit: true,
        trigger_type: "phase",
        trigger_reason: `${context.phase} is a mandatory retrieval phase`,
        requested_memory_types: requestedMemoryTypes,
        memory_mode: memoryMode,
        requested_scopes: scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold: context.phase === "session_start" ? 4 : 3,
        cooldown_applied: false,
      };
    }

    if (HISTORY_PATTERNS.some((pattern) => normalizedInput.includes(pattern.toLowerCase()))) {
      this.recordCooldown(cooldownKey, normalizedInput);
      return {
        hit: true,
        trigger_type: "history_reference",
        trigger_reason: "current input explicitly references prior context or preferences",
        requested_memory_types: requestedMemoryTypes,
        memory_mode: memoryMode,
        requested_scopes: scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold: 3,
        cooldown_applied: false,
      };
    }

    if (shouldSkipForShortInput(context.current_input)) {
      return {
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: "input is too short and has no clear historical reference",
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold: 3,
        cooldown_applied: false,
      };
    }

    const semanticScore = await this.semanticFallbackScore(context, memoryMode, scopePlan.scopes);
    if (semanticScore.degraded) {
      return {
        hit: false,
        trigger_type: "no_trigger",
        trigger_reason: "semantic fallback degraded due to dependency failure",
        requested_memory_types: [],
        memory_mode: memoryMode,
        requested_scopes: scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold: 3,
        cooldown_applied: false,
        semantic_score: semanticScore.score,
        degraded: true,
        degradation_reason: semanticScore.degradation_reason,
      };
    }

    if (semanticScore.score >= this.config.SEMANTIC_TRIGGER_THRESHOLD) {
      this.recordCooldown(cooldownKey, normalizedInput);
      return {
        hit: true,
        trigger_type: "semantic_fallback",
        trigger_reason: "semantic similarity exceeded the fallback threshold",
        requested_memory_types: requestedMemoryTypes,
        memory_mode: memoryMode,
        requested_scopes: scopePlan.scopes,
        scope_reason: scopePlan.reason,
        importance_threshold: 4,
        cooldown_applied: false,
        semantic_score: semanticScore.score,
      };
    }

    return {
      hit: false,
      trigger_type: "no_trigger",
      trigger_reason: "no hard trigger matched and semantic fallback stayed below threshold",
      requested_memory_types: [],
      memory_mode: memoryMode,
      requested_scopes: scopePlan.scopes,
      scope_reason: scopePlan.reason,
      importance_threshold: 3,
      cooldown_applied: false,
      semantic_score: semanticScore.score,
    };
  }

  private recordCooldown(key: string, input: string): void {
    this.cooldown.set(key, {
      input,
      expires_at: Date.now() + this.config.TRIGGER_COOLDOWN_MS,
    });
  }

  private async semanticFallbackScore(
    context: TriggerContext,
    memoryMode: MemoryMode,
    requestedScopes: ScopeType[],
  ): Promise<{
    score: number;
    degraded: boolean;
    degradation_reason?: string;
  }> {
    const queryText = normalizeText(context.current_input);
    if (!queryText) {
      return { score: 0, degraded: false };
    }

    const embeddingResult = await this.dependencyGuard.run(
      "embeddings",
      this.config.EMBEDDING_TIMEOUT_MS,
      (signal) => this.embeddingsClient.embedText(queryText, signal),
    );
    const sampleResult = await this.dependencyGuard.run(
      "read_model",
      this.config.QUERY_TIMEOUT_MS,
      (signal) =>
        this.readModelRepository.searchCandidates(
          {
            workspace_id: context.workspace_id,
            user_id: context.user_id,
            session_id: context.session_id,
            phase: context.phase,
            task_id: context.task_id,
            memory_mode: memoryMode,
            scope_filter: requestedScopes,
            memory_type_filter: ["fact_preference", "task_state", "episodic"],
            status_filter: ["active"],
            importance_threshold: 4,
            semantic_query_text: queryText,
            candidate_limit: 8,
          },
          signal,
        ),
    );

    if (!embeddingResult.ok || !sampleResult.ok) {
      this.logger.warn(
        {
          embeddingStatus: embeddingResult.status.status,
          sampleStatus: sampleResult.status.status,
        },
        "semantic fallback degraded",
      );
      return {
        score: 0,
        degraded: true,
        degradation_reason:
          embeddingResult.error?.code ??
          sampleResult.error?.code ??
          "dependency_unavailable",
      };
    }

    const queryEmbedding = embeddingResult.value ?? [];
    const samples = sampleResult.value ?? [];

    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      return { score: 0, degraded: false };
    }

    let best = 0;
    for (const sample of samples) {
      const embedding = sample.summary_embedding;
      if (!embedding || embedding.length !== queryEmbedding.length) {
        continue;
      }
      let dot = 0;
      let leftNorm = 0;
      let rightNorm = 0;
      for (let index = 0; index < embedding.length; index += 1) {
        const left = queryEmbedding[index] ?? 0;
        const right = embedding[index] ?? 0;
        dot += left * right;
        leftNorm += left * left;
        rightNorm += right * right;
      }
      if (leftNorm === 0 || rightNorm === 0) {
        continue;
      }
      best = Math.max(best, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
    }

    return { score: best, degraded: false };
  }
}
