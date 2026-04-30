export const DEFAULT_LITE_FULL_UPGRADE_RECORD_THRESHOLD = 5000;

export interface LiteUpgradeSuggestion {
  should_upgrade: boolean;
  reason_code?: "record_count_exceeded" | "search_latency_high";
  message?: string;
  record_count: number;
  threshold: number;
  command: "axis start --full";
}

export function buildLiteUpgradeSuggestion(input: {
  recordCount: number;
  threshold?: number;
  searchLatencyMs?: number;
}): LiteUpgradeSuggestion {
  const threshold = input.threshold ?? DEFAULT_LITE_FULL_UPGRADE_RECORD_THRESHOLD;
  if (input.recordCount > threshold) {
    return {
      should_upgrade: true,
      reason_code: "record_count_exceeded",
      message: `精简模式已有 ${input.recordCount} 条记忆，建议切换到完整平台以获得向量检索和治理能力。`,
      record_count: input.recordCount,
      threshold,
      command: "axis start --full",
    };
  }

  if (typeof input.searchLatencyMs === "number" && input.searchLatencyMs > 200) {
    return {
      should_upgrade: true,
      reason_code: "search_latency_high",
      message: `精简模式本地搜索耗时 ${Math.round(input.searchLatencyMs)}ms，建议切换到完整平台。`,
      record_count: input.recordCount,
      threshold,
      command: "axis start --full",
    };
  }

  return {
    should_upgrade: false,
    record_count: input.recordCount,
    threshold,
    command: "axis start --full",
  };
}
