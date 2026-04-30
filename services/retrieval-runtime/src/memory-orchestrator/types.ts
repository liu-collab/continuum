import type {
  CandidateMemory,
  FinalizeTurnInput,
  GovernanceExecutionItem,
  MemoryConflictSnapshot,
  MemoryMode,
  MemoryRecordSnapshot,
  MemoryType,
  ScopeType,
  TriggerContext,
  WriteBackCandidate,
} from "../shared/types.js";

export interface RecallSearchPlan {
  needs_memory?: boolean;
  intent_confidence?: number;
  intent_reason?: string;
  should_search: boolean;
  reason: string;
  requested_scopes?: ScopeType[];
  requested_memory_types?: MemoryType[];
  importance_threshold?: number;
  query_hint?: string;
  candidate_limit?: number;
}

export interface RecallInjectionPlan {
  should_inject: boolean;
  reason: string;
  selected_record_ids?: string[];
  memory_summary?: string;
  requested_scopes?: ScopeType[];
  requested_memory_types?: MemoryType[];
  importance_threshold?: number;
}

export interface RecallSearchInput {
  context: TriggerContext;
  memory_mode: MemoryMode;
  requested_scopes: ScopeType[];
  requested_memory_types: MemoryType[];
  semantic_score?: number;
  semantic_threshold?: number;
}

export interface RecallInjectionInput {
  context: TriggerContext;
  memory_mode: MemoryMode;
  requested_scopes: ScopeType[];
  requested_memory_types: MemoryType[];
  candidates: CandidateMemory[];
  search_reason?: string;
  semantic_score?: number;
  semantic_threshold?: number;
  allow_recent_replay?: boolean;
}

export interface RecallSearchPlanner {
  plan(input: RecallSearchInput): Promise<RecallSearchPlan>;
  healthCheck?(): Promise<void> | undefined;
}

export interface RecallInjectionPlanner {
  plan(input: RecallInjectionInput): Promise<RecallInjectionPlan>;
  healthCheck?(): Promise<void> | undefined;
}

export interface IntentAnalyzerInput {
  current_input: string;
  session_context: {
    session_id: string;
    workspace_id: string;
    recent_turns: Array<{
      user_input: string;
      assistant_output: string;
    }>;
  };
}

export interface IntentAnalyzerOutput {
  needs_memory: boolean;
  memory_types: MemoryType[];
  urgency: "immediate" | "deferred" | "optional";
  confidence: number;
  reason: string;
  suggested_scopes?: ScopeType[];
}

export interface IntentAnalyzer {
  analyze(input: IntentAnalyzerInput): Promise<IntentAnalyzerOutput>;
  healthCheck?(): Promise<void> | undefined;
}

export interface WritebackExtractionCandidate {
  candidate_type: MemoryType;
  scope: ScopeType;
  summary: string;
  importance: number;
  confidence: number;
  write_reason: string;
}

export interface WritebackExtractionResult {
  candidates: WritebackExtractionCandidate[];
}

export interface WritebackRuleHint {
  summary: string;
  candidate_type: WritebackExtractionCandidate["candidate_type"];
  scope: WritebackExtractionCandidate["scope"];
  importance: number;
  confidence: number;
}

export interface RuleCandidateDigest {
  index: number;
  candidate_type: WritebackExtractionCandidate["candidate_type"];
  scope: WritebackExtractionCandidate["scope"];
  summary: string;
  importance: number;
  confidence: number;
  write_reason: string;
}

export interface WritebackRefineItem {
  source: string;
  action: "keep" | "drop" | "merge" | "new";
  summary?: string;
  importance?: number;
  confidence?: number;
  scope?: ScopeType;
  candidate_type?: WritebackExtractionCandidate["candidate_type"];
  merge_with?: string[];
  reason: string;
}

export interface WritebackRefineInput {
  current_input: string;
  assistant_output: string;
  recent_context_summary?: string;
  tool_results_summary?: string;
  task_id?: string;
  rule_candidates: RuleCandidateDigest[];
}

export interface WritebackRefineResult {
  refined_candidates: WritebackRefineItem[];
}

export interface WritebackPlanner {
  extract(input: Pick<FinalizeTurnInput, "current_input" | "assistant_output" | "recent_context_summary" | "tool_results_summary" | "task_id"> & {
    recent_turns?: Array<{
      role: "user" | "assistant" | "system" | "tool";
      summary: string;
      turn_id?: string;
    }>;
    rule_hints?: WritebackRuleHint[];
  }): Promise<WritebackExtractionResult>;
  refine(input: WritebackRefineInput): Promise<WritebackRefineResult>;
  healthCheck?(): Promise<void> | undefined;
}

export interface QualityAssessmentIssue {
  type: "duplicate" | "low_quality" | "conflict" | "vague";
  severity: "high" | "medium" | "low";
  description: string;
}

export interface QualityAssessment {
  candidate_id: string;
  quality_score: number;
  confidence: number;
  potential_conflicts: string[];
  suggested_importance: number;
  suggested_status: "active" | "pending_confirmation";
  issues: QualityAssessmentIssue[];
  reason: string;
}

export interface QualityAssessorInput {
  writeback_candidates: WriteBackCandidate[];
  existing_similar_records: MemoryRecordSnapshot[];
  turn_context: {
    user_input: string;
    assistant_output: string;
    recent_context_summary?: string;
  };
}

export interface QualityAssessorResult {
  assessments: QualityAssessment[];
}

export interface QualityAssessor {
  assess(input: QualityAssessorInput): Promise<QualityAssessorResult>;
  healthCheck?(): Promise<void> | undefined;
}

export interface RecallEffectivenessInputMemory {
  record_id: string;
  summary: string;
  importance: number;
}

export interface RecallEffectivenessUserFeedback {
  rating?: number;
  comment?: string;
}

export interface RecallEffectivenessEvaluation {
  record_id: string;
  was_used: boolean;
  usage_confidence: number;
  effectiveness_score: number;
  suggested_importance_adjustment: number;
  usage_evidence?: string;
  reason: string;
}

export interface RecallEffectivenessEvaluatorInput {
  injected_memories: RecallEffectivenessInputMemory[];
  assistant_output: string;
  tool_behavior_summary?: string;
  user_feedback?: RecallEffectivenessUserFeedback;
}

export interface RecallEffectivenessEvaluatorResult {
  evaluations: RecallEffectivenessEvaluation[];
}

export interface RecallEffectivenessEvaluator {
  evaluate(input: RecallEffectivenessEvaluatorInput): Promise<RecallEffectivenessEvaluatorResult>;
  healthCheck?(): Promise<void> | undefined;
}

export interface GovernancePlanInput {
  seed_records: MemoryRecordSnapshot[];
  related_records: MemoryRecordSnapshot[];
  open_conflicts: MemoryConflictSnapshot[];
  recently_rejected?: Array<{
    proposal_type: string;
    reason_text: string;
    verifier_notes: string | null;
  }>;
}

export type GovernanceAction =
  | {
      type: "merge";
      target_record_ids: string[];
      merged_summary: string;
      merged_importance?: number;
      reason: string;
    }
  | {
      type: "archive";
      record_id: string;
      reason: string;
    }
  | {
      type: "downgrade";
      record_id: string;
      new_importance: number;
      reason: string;
    }
  | {
      type: "summarize";
      source_record_ids: string[];
      new_summary: string;
      new_importance: number;
      scope: ScopeType;
      candidate_type: WritebackExtractionCandidate["candidate_type"];
      reason: string;
    }
  | {
      type: "delete";
      record_id: string;
      reason: string;
      delete_reason: string;
    }
  | {
      type: "resolve_conflict";
      conflict_id: string;
      resolution_type: "auto_merge" | "manual_fix" | "dismissed";
      activate_record_id?: string;
      resolution_note: string;
    };

export interface GovernancePlan {
  actions: GovernanceAction[];
  notes?: string;
}

export interface GovernancePlanner {
  plan(input: GovernancePlanInput): Promise<GovernancePlan>;
  healthCheck?(): Promise<void> | undefined;
}

export interface GovernanceVerificationResult {
  decision: "approve" | "reject";
  confidence: number;
  notes: string;
}

export interface GovernanceVerifierInput {
  proposal: GovernanceExecutionItem;
  seed_records: MemoryRecordSnapshot[];
  related_records: MemoryRecordSnapshot[];
  open_conflicts: MemoryConflictSnapshot[];
}

export interface GovernanceVerifier {
  verify(input: GovernanceVerifierInput): Promise<GovernanceVerificationResult>;
}

export type MemoryRelationType =
  | "depends_on"
  | "conflicts_with"
  | "extends"
  | "supersedes"
  | "related_to";

export interface RelationDiscovererInput {
  source_record: MemoryRecordSnapshot;
  candidate_records: MemoryRecordSnapshot[];
  context?: {
    workspace_id: string;
    user_id: string;
  };
}

export interface RelationDiscoveryItem {
  target_record_id: string;
  relation_type: MemoryRelationType;
  strength: number;
  bidirectional: boolean;
  reason: string;
}

export interface RelationDiscoveryResult {
  source_record_id: string;
  relations: RelationDiscoveryItem[];
}

export interface RelationDiscoverer {
  discover(input: RelationDiscovererInput): Promise<RelationDiscoveryResult>;
  healthCheck?(): Promise<void> | undefined;
}

export interface ProactiveRecommenderInput {
  current_context: {
    user_input: string;
    session_context: {
      session_id: string;
      workspace_id: string;
      user_id?: string;
      recent_context_summary?: string;
    };
    detected_task_type?: string;
  };
  available_memories: MemoryRecordSnapshot[];
}

export interface ProactiveRecommendationItem {
  record_id: string;
  relevance_score: number;
  trigger_reason: "task_similarity" | "forgotten_context" | "related_decision" | "conflict_warning";
  suggestion: string;
  auto_inject: boolean;
}

export interface ProactiveRecommendationResult {
  recommendations: ProactiveRecommendationItem[];
}

export interface ProactiveRecommender {
  recommend(input: ProactiveRecommenderInput): Promise<ProactiveRecommendationResult>;
  healthCheck?(): Promise<void> | undefined;
}

export type MemoryEvolutionType =
  | "knowledge_extraction"
  | "pattern_discovery"
  | "summarization";

export interface EvolutionPlannerInput {
  source_records: MemoryRecordSnapshot[];
  time_window: {
    start: string;
    end: string;
  };
  evolution_type: MemoryEvolutionType;
}

export interface EvolvedKnowledge {
  pattern: string;
  confidence: number;
  evidence_count: number;
  suggested_scope: "user" | "workspace";
  suggested_importance: number;
}

export interface EvolutionConsolidationPlan {
  new_summary: string;
  records_to_archive: string[];
}

export interface EvolutionPlan {
  evolution_type: MemoryEvolutionType;
  source_records: string[];
  extracted_knowledge?: EvolvedKnowledge;
  consolidation_plan?: EvolutionConsolidationPlan;
}

export interface EvolutionPlanner {
  plan(input: EvolutionPlannerInput): Promise<EvolutionPlan>;
  healthCheck?(): Promise<void> | undefined;
}

export interface MemoryOrchestrator {
  intent?: IntentAnalyzer;
  recall?: {
    search?: RecallSearchPlanner;
    injection?: RecallInjectionPlanner;
    effectiveness?: RecallEffectivenessEvaluator;
  };
  writeback?: WritebackPlanner;
  quality?: QualityAssessor;
  relation?: RelationDiscoverer;
  recommendation?: ProactiveRecommender;
  governance?: {
    planner?: GovernancePlanner;
    verifier?: GovernanceVerifier;
    evolution?: EvolutionPlanner;
  };
}
