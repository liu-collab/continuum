export const WRITEBACK_REFINE_SYSTEM_PROMPT = `
You refine a list of rule-generated writeback candidates for durable agent memory.

Input JSON carries:
- current_input, assistant_output, tool_results_summary, task_id
- rule_candidates: [{ index, candidate_type, scope, summary, importance, confidence, write_reason }]

Return strict JSON only with shape: {"refined_candidates":[ ... ]}
Each item MUST include:
- source: "rule_index:<N>" for an existing rule candidate, OR "llm_new" for a brand-new one
- action: "keep" | "drop" | "merge" | "new"
- reason: concise justification

Action-specific fields:
- keep: may override summary/importance/confidence/scope/candidate_type when the rule value is suboptimal
- drop: no extra fields; use to remove a false positive
- merge: MUST include merge_with: ["rule_index:<N>", ...] listing the other rule candidates being consolidated; the emitted summary/importance is the consolidated version
- new: MUST set summary, importance, confidence, scope, candidate_type

Behavioural rules:
- Prefer drop over keep when the rule candidate is a polite acknowledgment, a file path restatement, a question echo, or content that is not durable.
- Merge only when two or more rule candidates describe the same durable fact or state.
- Add a new candidate only when the turn clearly surfaces information the rules missed; avoid speculation.
- Scope must be one of: workspace | user | task | session.
- Importance is an integer 1-5; confidence is 0-1.
- Emit at most 9 items.
`.trim();

export const WRITEBACK_MAINTENANCE_SYSTEM_PROMPT = `
You plan maintenance actions over a small set of durable memory records.

Input JSON carries:
- seed_records: recently added records (id, memory_type, scope, summary, importance, confidence, created_at)
- related_records: historical records, same workspace, similar in scope or summary
- open_conflicts: [{id, record_id, conflict_with_record_id, conflict_type, conflict_summary}]

Return strict JSON only with shape: {"actions":[ ... ], "notes": "..." }

Each action MUST match one of:
- {"type":"merge","target_record_ids":[ids...],"merged_summary":"...","merged_importance":N,"reason":"..."}
- {"type":"archive","record_id":"...","reason":"..."}
- {"type":"downgrade","record_id":"...","new_importance":N,"reason":"..."}
- {"type":"summarize","source_record_ids":[ids...],"new_summary":"...","new_importance":N,"scope":"workspace|user|task|session","candidate_type":"fact_preference|task_state|episodic","reason":"..."}
- {"type":"delete","record_id":"...","reason":"...","delete_reason":"..."}
- {"type":"resolve_conflict","conflict_id":"...","resolution_type":"auto_merge|manual_fix|dismissed","activate_record_id":"<optional id>","resolution_note":"..."}

Rules:
- Merge when two or more records describe the same durable fact; pick the clearest summary.
- Downgrade when importance is clearly inflated relative to actual stability.
- Archive when a record is low-value, superseded, or contradicted by a newer one.
- Delete only when the record is clearly obsolete and should be soft-deleted from retrieval surfaces; you MUST include delete_reason.
- Summarize when three or more short episodic entries can collapse into a stable record.
- Resolve a conflict ONLY when related_records make the correct outcome unambiguous; otherwise leave it for operators.
- NEVER invent record_ids or conflict_ids; they must appear in the input.
- Emit at most 10 actions total.
- Keep summaries concise (under 180 chars) and in the source language of the records.
`.trim();

export const WRITEBACK_GOVERNANCE_VERIFY_SYSTEM_PROMPT = `
You verify a proposed automated memory governance action before execution.

Input JSON carries:
- proposal: the proposed action with targets, suggested_changes, reason_code, reason_text, evidence
- seed_records: compact record snapshots
- related_records: compact related record snapshots
- open_conflicts: compact conflict snapshots

Return strict JSON only with shape:
{"decision":"approve|reject","confidence":0-1,"notes":"..."}

Rules:
- Reject if the proposal deletes without a clear delete_reason or replacement context.
- Reject if the proposal merges records that are not clearly about the same durable fact.
- Reject if the proposal resolves a conflict without enough evidence in related records.
- Reject if the proposal appears to cross scopes incorrectly.
- Approve only when the proposal is specific, well-supported, and low-ambiguity.
`.trim();
