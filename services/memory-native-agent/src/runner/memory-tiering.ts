type InjectionRecord = {
  id: string;
  memory_type: string;
  scope: string;
  summary: string;
  importance: number;
  confidence: number;
};

export interface MemoryInjectionInput {
  phase: string;
  injection_reason: string;
  memory_summary: string;
  memory_records: InjectionRecord[];
}

export interface TieredInjectionRecord extends InjectionRecord {}

export interface TieredInjectionDrop {
  id: string;
  reason: "limit" | "score" | "duplicate";
}

export interface TieredInjectionResult {
  phase: string;
  injection_reason: string;
  memory_summary: string;
  high: TieredInjectionRecord[];
  medium: TieredInjectionRecord[];
  summary_records: TieredInjectionRecord[];
  summary: string | null;
  dropped: TieredInjectionDrop[];
}

export interface MemoryTieringConfig {
  highImportanceThreshold: number;
  highConfidenceThreshold: number;
  maxHighRecords: number;
  maxMediumRecords: number;
  maxSummaryRecords: number;
}

const DEFAULT_CONFIG: MemoryTieringConfig = {
  highImportanceThreshold: 0.85,
  highConfidenceThreshold: 0.9,
  maxHighRecords: 3,
  maxMediumRecords: 5,
  maxSummaryRecords: 3,
};

export function tierMemoryInjection(
  input: MemoryInjectionInput,
  config: Partial<MemoryTieringConfig> = {},
): TieredInjectionResult {
  const resolved = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const dropped: TieredInjectionDrop[] = [];
  const deduped = dedupeRecords(input.memory_records, dropped);
  const ranked = [...deduped].sort(compareRecords);

  const high: TieredInjectionRecord[] = [];
  const medium: TieredInjectionRecord[] = [];
  const summaryCandidates: TieredInjectionRecord[] = [];

  for (const record of ranked) {
    if (isHighPriority(record, resolved)) {
      if (high.length < resolved.maxHighRecords) {
        high.push(record);
      } else {
        dropped.push({ id: record.id, reason: "limit" });
      }
      continue;
    }

    if (isMediumPriority(record)) {
      if (medium.length < resolved.maxMediumRecords) {
        medium.push(record);
      } else {
        dropped.push({ id: record.id, reason: "limit" });
      }
      continue;
    }

    if (summaryCandidates.length < resolved.maxSummaryRecords) {
      summaryCandidates.push(record);
      continue;
    }

    dropped.push({ id: record.id, reason: "score" });
  }

  const summary = buildSummary(input.memory_summary, summaryCandidates, high.length + medium.length > 0);

  return {
    phase: input.phase,
    injection_reason: input.injection_reason,
    memory_summary: input.memory_summary,
    high,
    medium,
    summary_records: summaryCandidates,
    summary,
    dropped,
  };
}

function isHighPriority(record: TieredInjectionRecord, config: MemoryTieringConfig) {
  return record.memory_type === "fact_preference"
    && (record.importance >= config.highImportanceThreshold || record.confidence >= config.highConfidenceThreshold);
}

function isMediumPriority(record: TieredInjectionRecord) {
  return record.memory_type === "task_state" || record.memory_type === "fact_preference" || record.memory_type === "episodic";
}

function compareRecords(left: TieredInjectionRecord, right: TieredInjectionRecord) {
  if (left.memory_type !== right.memory_type) {
    return priorityForType(left.memory_type) - priorityForType(right.memory_type);
  }
  if (left.importance !== right.importance) {
    return right.importance - left.importance;
  }
  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }
  return left.summary.localeCompare(right.summary);
}

function priorityForType(memoryType: string) {
  switch (memoryType) {
    case "fact_preference":
      return 0;
    case "task_state":
      return 1;
    case "episodic":
      return 2;
    default:
      return 99;
  }
}

function dedupeRecords(records: InjectionRecord[], dropped: TieredInjectionDrop[]) {
  const seen = new Map<string, TieredInjectionRecord>();

  for (const record of records) {
    const key = `${record.memory_type}::${record.scope}::${normalizeSummary(record.summary)}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...record });
      continue;
    }

    if (compareRecords(record, existing) < 0) {
      dropped.push({ id: existing.id, reason: "duplicate" });
      seen.set(key, { ...record });
      continue;
    }

    dropped.push({ id: record.id, reason: "duplicate" });
  }

  return [...seen.values()];
}

function normalizeSummary(summary: string) {
  return summary.replace(/\s+/g, " ").trim().toLowerCase();
}

function buildSummary(memorySummary: string, records: TieredInjectionRecord[], hasPrimaryRecords: boolean) {
  const snippets = records
    .map((record) => record.summary.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (snippets.length === 0) {
    return hasPrimaryRecords ? null : memorySummary.trim() || null;
  }

  return `${memorySummary.trim()}\n- ${snippets.join("\n- ")}`.trim();
}
