export type PromptSegmentKind =
  | "core_system"
  | "memory_high"
  | "memory_medium"
  | "memory_summary"
  | "history_summary";

export interface PromptSegmentView {
  kind: PromptSegmentKind;
  priority: "fixed" | "high" | "medium" | "low";
  preview: string;
  phase?: string;
  record_ids?: string[];
  record_count?: number;
}

export interface MemoryTieringTurnExpectation {
  requireKinds?: PromptSegmentKind[];
  forbidKinds?: PromptSegmentKind[];
  requirePhases?: string[];
  minHighRecordCount?: number;
  minSummarySegmentCount?: number;
}

export interface MemoryTieringTurnSpec {
  id: string;
  label: string;
  text: string;
  expectation?: MemoryTieringTurnExpectation;
}

export interface MemoryTieringScenario {
  id: string;
  label: string;
  description: string;
  turns: MemoryTieringTurnSpec[];
}

export interface MemoryTieringAggregation {
  kinds: PromptSegmentKind[];
  phases: string[];
  highSegmentCount: number;
  summarySegmentCount: number;
  highRecordCount: number;
  summaryRecordCount: number;
}

export interface MemoryTieringTurnAnalysis {
  passed: boolean;
  failures: string[];
  aggregation: MemoryTieringAggregation;
}

export const DEFAULT_MEMORY_TIERING_SCENARIO: MemoryTieringScenario = {
  id: "stable-preferences-multi-turn",
  label: "稳定偏好多轮触发",
  description: "先写入长期偏好，再用显式引用触发 memory_high 和 memory_summary，最后用中性问题做对照。",
  turns: [
    {
      id: "remember-language",
      label: "写入语言偏好",
      text: "以后默认用中文回答，除非我明确要求英文。这是长期偏好。",
      expectation: {
        forbidKinds: ["memory_high", "memory_summary"],
      },
    },
    {
      id: "recall-language",
      label: "显式引用语言偏好",
      text: "先帮我规划一下今天的工作安排，并按照我之前的默认偏好来回答。",
      expectation: {
        requireKinds: ["memory_high", "memory_summary"],
        requirePhases: ["before_plan", "before_response"],
        minHighRecordCount: 1,
        minSummarySegmentCount: 1,
      },
    },
    {
      id: "remember-format",
      label: "写入格式偏好",
      text: "我习惯你给答案时先给结论，再给最多 3 个短点。这是长期偏好，请记住。",
    },
    {
      id: "recall-combined-preferences",
      label: "同时引用语言和格式偏好",
      text: "现在帮我设计一个发布方案，按我之前的默认语言和回答格式来答，先给结论，再给最多 3 个短点。",
      expectation: {
        requireKinds: ["memory_high", "memory_summary"],
        requirePhases: ["before_plan", "before_response"],
        minHighRecordCount: 2,
        minSummarySegmentCount: 1,
      },
    },
    {
      id: "neutral-control",
      label: "中性问题对照",
      text: "你能干啥",
      expectation: {
        forbidKinds: ["memory_high", "memory_summary"],
      },
    },
  ],
};

export function aggregatePromptSegments(promptSegments: PromptSegmentView[]): MemoryTieringAggregation {
  const kinds = promptSegments.map((segment) => segment.kind);
  const phases = [...new Set(promptSegments.map((segment) => segment.phase).filter((phase): phase is string => Boolean(phase)))];
  const highSegments = promptSegments.filter((segment) => segment.kind === "memory_high");
  const summarySegments = promptSegments.filter((segment) => segment.kind === "memory_summary");

  return {
    kinds,
    phases,
    highSegmentCount: highSegments.length,
    summarySegmentCount: summarySegments.length,
    highRecordCount: highSegments.reduce((sum, segment) => sum + (segment.record_count ?? 0), 0),
    summaryRecordCount: summarySegments.reduce((sum, segment) => sum + (segment.record_count ?? 0), 0),
  };
}

export function evaluateTurnExpectations(
  promptSegments: PromptSegmentView[],
  expectation?: MemoryTieringTurnExpectation,
): MemoryTieringTurnAnalysis {
  const aggregation = aggregatePromptSegments(promptSegments);
  const failures: string[] = [];

  if (expectation?.requireKinds) {
    for (const kind of expectation.requireKinds) {
      if (!aggregation.kinds.includes(kind)) {
        failures.push(`缺少必需的 prompt segment: ${kind}`);
      }
    }
  }

  if (expectation?.forbidKinds) {
    for (const kind of expectation.forbidKinds) {
      if (aggregation.kinds.includes(kind)) {
        failures.push(`出现了不期望的 prompt segment: ${kind}`);
      }
    }
  }

  if (expectation?.requirePhases) {
    for (const phase of expectation.requirePhases) {
      if (!aggregation.phases.includes(phase)) {
        failures.push(`缺少必需的注入阶段: ${phase}`);
      }
    }
  }

  if (typeof expectation?.minHighRecordCount === "number" && aggregation.highRecordCount < expectation.minHighRecordCount) {
    failures.push(`memory_high record_count=${aggregation.highRecordCount}，低于期望值 ${expectation.minHighRecordCount}`);
  }

  if (
    typeof expectation?.minSummarySegmentCount === "number"
    && aggregation.summarySegmentCount < expectation.minSummarySegmentCount
  ) {
    failures.push(`memory_summary segment_count=${aggregation.summarySegmentCount}，低于期望值 ${expectation.minSummarySegmentCount}`);
  }

  return {
    passed: failures.length === 0,
    failures,
    aggregation,
  };
}
