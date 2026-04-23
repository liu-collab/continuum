import type { AppConfig } from "../config.js";
import type { InjectionBlock, InjectionRecord, MemoryPacket } from "../shared/types.js";
import { estimateTokens } from "../shared/utils.js";

const TYPE_PRIORITY = new Map([
  ["fact_preference", 0],
  ["task_state", 1],
  ["episodic", 2],
] as const);

const TYPE_ORDER: Array<MemoryPacket["records"][number]["memory_type"]> = [
  "fact_preference",
  "task_state",
  "episodic",
];

function sortRecords(records: MemoryPacket["records"]) {
  return [...records].sort((left, right) => {
    const leftPriority = TYPE_PRIORITY.get(left.memory_type) ?? 99;
    const rightPriority = TYPE_PRIORITY.get(right.memory_type) ?? 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    if ((left.rerank_score ?? 0) !== (right.rerank_score ?? 0)) {
      return (right.rerank_score ?? 0) - (left.rerank_score ?? 0);
    }
    if (left.importance !== right.importance) {
      return right.importance - left.importance;
    }
    return right.confidence - left.confidence;
  });
}

function recordToInjectionRecord(record: MemoryPacket["records"][number]): InjectionRecord {
  return {
    id: record.id,
    memory_type: record.memory_type,
    scope: record.scope,
    summary: record.summary,
    importance: record.importance,
    confidence: record.confidence,
    source: record.source,
  };
}

function isBlockedByOpenConflict(record: MemoryPacket["records"][number]) {
  return record.memory_type === "fact_preference" && record.has_open_conflict === true;
}

export class InjectionEngine {
  constructor(private readonly config: AppConfig) {}

  private buildMemoryHigh(records: InjectionRecord[]) {
    return records
      .filter((record) => record.importance >= 4)
      .slice(0, 3)
      .map((record) => record.summary);
  }

  build(packet: MemoryPacket): InjectionBlock | null {
    if (packet.records.length === 0) {
      return null;
    }

    const summaryTokens = estimateTokens(packet.packet_summary);
    const tokenBudget = this.config.INJECTION_TOKEN_BUDGET;
    const sortedRecords = sortRecords(packet.records);
    const eligibleRecords = sortedRecords.filter((record) => !isBlockedByOpenConflict(record));

    const kept: InjectionRecord[] = [];
    const trimmedRecordIds = sortedRecords
      .filter((record) => isBlockedByOpenConflict(record))
      .map((record) => record.id);
    const trimReasons = sortedRecords
      .filter((record) => isBlockedByOpenConflict(record))
      .map(() => "open_conflict");
    let usedTokens = summaryTokens;
    const keptIds = new Set<string>();

    const tryKeep = (record: MemoryPacket["records"][number]): boolean => {
      if (keptIds.has(record.id)) {
        return true;
      }

      const injectionRecord = recordToInjectionRecord(record);
      const recordTokens = estimateTokens(injectionRecord.summary);
      const overRecordLimit = kept.length >= this.config.INJECTION_RECORD_LIMIT;
      const overBudget = usedTokens + recordTokens > tokenBudget;

      if (overRecordLimit || overBudget) {
        return false;
      }

      kept.push(injectionRecord);
      keptIds.add(record.id);
      usedTokens += recordTokens;
      return true;
    };

    if (this.config.INJECTION_RECORD_LIMIT >= 2) {
      const grouped = new Map<MemoryPacket["records"][number]["memory_type"], MemoryPacket["records"]>();
      for (const type of TYPE_ORDER) {
        grouped.set(
          type,
          eligibleRecords.filter((record) => record.memory_type === type),
        );
      }

      for (const type of ["fact_preference", "task_state"] as const) {
        const first = grouped.get(type)?.[0];
        if (!first) {
          continue;
        }
        if (!tryKeep(first)) {
          trimmedRecordIds.push(first.id);
          trimReasons.push(kept.length >= this.config.INJECTION_RECORD_LIMIT ? "record_limit" : "token_budget");
        }
      }
    }

    for (const record of eligibleRecords) {
      if (keptIds.has(record.id)) {
        continue;
      }
      if (!tryKeep(record)) {
        trimmedRecordIds.push(record.id);
        trimReasons.push(kept.length >= this.config.INJECTION_RECORD_LIMIT ? "record_limit" : "token_budget");
      }
    }

    return {
      injection_reason: packet.trigger,
      memory_high: this.buildMemoryHigh(kept),
      memory_summary: packet.packet_summary,
      memory_records: kept,
      token_estimate: usedTokens,
      memory_mode: packet.memory_mode,
      requested_scopes: packet.requested_scopes,
      selected_scopes: [...new Set(kept.map((record) => record.scope))],
      trimmed_record_ids: trimmedRecordIds,
      trim_reasons: trimReasons,
    };
  }
}
