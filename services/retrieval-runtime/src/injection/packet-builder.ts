import { randomUUID } from "node:crypto";

import type { CandidateMemory, MemoryPacket, MemoryType, RetrievalQuery, TriggerDecision } from "../shared/types.js";
import { textToLines } from "../shared/utils.js";

function summarizeRecords(records: CandidateMemory[]): string {
  if (records.length === 0) {
    return "No active memory matched this trigger.";
  }

  const groups = new Map<MemoryType, CandidateMemory[]>();
  for (const record of records) {
    const current = groups.get(record.memory_type) ?? [];
    current.push(record);
    groups.set(record.memory_type, current);
  }

  const orderedTypes: MemoryType[] = ["fact_preference", "task_state", "episodic"];
  return orderedTypes
    .filter((type) => (groups.get(type)?.length ?? 0) > 0)
    .map((type) => {
      const entries = groups.get(type) ?? [];
      const snippets = entries
        .slice(0, 2)
        .map((entry) => textToLines(entry.summary)[0] ?? entry.summary)
        .join("; ");
      return `${type}: ${snippets}`;
    })
    .join(" | ");
}

function injectionHint(decision: TriggerDecision): string {
  if (decision.requested_memory_types.includes("task_state")) {
    return "current task continuation";
  }
  if (decision.requested_memory_types.includes("fact_preference")) {
    return "background constraints";
  }
  return "historical reference";
}

export function buildMemoryPacket(
  query: RetrievalQuery,
  decision: TriggerDecision,
  candidates: CandidateMemory[],
): MemoryPacket {
  const priority_breakdown: Record<MemoryType, number> = {
    fact_preference: candidates.filter((candidate) => candidate.memory_type === "fact_preference").length,
    task_state: candidates.filter((candidate) => candidate.memory_type === "task_state").length,
    episodic: candidates.filter((candidate) => candidate.memory_type === "episodic").length,
  };

  return {
    packet_id: randomUUID(),
    trigger: decision.trigger_reason,
    query_scope: `scope=${query.scope_filter.join(",")}; types=${query.memory_type_filter.join(",")}; importance>=${query.importance_threshold}`,
    records: candidates,
    packet_summary: summarizeRecords(candidates),
    injection_hint: injectionHint(decision),
    ttl_ms: 5 * 60 * 1000,
    priority_breakdown,
    ...(candidates.length === 0 ? { empty_reason: "no_candidate_memory" } : {}),
  };
}
