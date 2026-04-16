import type { AppConfig } from "../config.js";
import type { InjectionBlock, InjectionRecord, MemoryPacket } from "../shared/types.js";
import { estimateTokens } from "../shared/utils.js";

const TYPE_PRIORITY = new Map([
  ["fact_preference", 0],
  ["task_state", 1],
  ["episodic", 2],
] as const);

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

export class InjectionEngine {
  constructor(private readonly config: AppConfig) {}

  build(packet: MemoryPacket): InjectionBlock | null {
    if (packet.records.length === 0) {
      return null;
    }

    const summaryTokens = estimateTokens(packet.packet_summary);
    const tokenBudget = this.config.INJECTION_TOKEN_BUDGET;
    const sortedRecords = [...packet.records].sort((left, right) => {
      const leftPriority = TYPE_PRIORITY.get(left.memory_type) ?? 99;
      const rightPriority = TYPE_PRIORITY.get(right.memory_type) ?? 99;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      if (left.importance !== right.importance) {
        return right.importance - left.importance;
      }
      return right.confidence - left.confidence;
    });

    const kept: InjectionRecord[] = [];
    const trimmedRecordIds: string[] = [];
    const trimReasons: string[] = [];
    let usedTokens = summaryTokens;

    for (const record of sortedRecords) {
      const injectionRecord = recordToInjectionRecord(record);
      const recordTokens = estimateTokens(injectionRecord.summary);
      const overRecordLimit = kept.length >= this.config.INJECTION_RECORD_LIMIT;
      const overBudget = usedTokens + recordTokens > tokenBudget;

      if (overRecordLimit || overBudget) {
        trimmedRecordIds.push(record.id);
        trimReasons.push(overRecordLimit ? "record_limit" : "token_budget");
        continue;
      }

      kept.push(injectionRecord);
      usedTokens += recordTokens;
    }

    return {
      injection_reason: packet.trigger,
      memory_summary: packet.packet_summary,
      memory_records: kept,
      token_estimate: usedTokens,
      trimmed_record_ids: trimmedRecordIds,
      trim_reasons: trimReasons,
    };
  }
}
