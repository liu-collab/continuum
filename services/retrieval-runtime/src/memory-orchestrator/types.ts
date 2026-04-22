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
} from "../shared/types.js";

export interface RecallSearchPlan {
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
}

export interface RecallSearchPlanner {
  plan(input: RecallSearchInput): Promise<RecallSearchPlan>;
  healthCheck?(): Promise<void> | undefined;
}

export interface RecallInjectionPlanner {
  plan(input: RecallInjectionInput): Promise<RecallInjectionPlan>;
  healthCheck?(): Promise<void> | undefined;
}

export interface WritebackExtractionCandidate {
  candidate_type: "fact_preference" | "task_state" | "episodic";
  scope: ScopeType;
  summary: string;
  importance: number;
  confidence: number;
  write_reason: string;
}

export interface WritebackExtractionResult {
  candidates: WritebackExtractionCandidate[];
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
  tool_results_summary?: string;
  task_id?: string;
  rule_candidates: RuleCandidateDigest[];
}

export interface WritebackRefineResult {
  refined_candidates: WritebackRefineItem[];
}

export interface WritebackPlanner {
  extract(input: Pick<FinalizeTurnInput, "current_input" | "assistant_output" | "tool_results_summary" | "task_id">): Promise<WritebackExtractionResult>;
  refine(input: WritebackRefineInput): Promise<WritebackRefineResult>;
  healthCheck?(): Promise<void> | undefined;
}

export interface GovernancePlanInput {
  seed_records: MemoryRecordSnapshot[];
  related_records: MemoryRecordSnapshot[];
  open_conflicts: MemoryConflictSnapshot[];
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

export interface MemoryOrchestrator {
  recall?: {
    search?: RecallSearchPlanner;
    injection?: RecallInjectionPlanner;
  };
  writeback?: WritebackPlanner;
  governance?: {
    planner?: GovernancePlanner;
    verifier?: GovernanceVerifier;
  };
}
