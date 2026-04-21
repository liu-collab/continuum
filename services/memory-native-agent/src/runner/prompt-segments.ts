import type { ChatMessage } from "../providers/types.js";

export type PromptSegmentKind =
  | "core_system"
  | "memory_high"
  | "memory_medium"
  | "memory_summary"
  | "history_summary";

export type PromptSegmentPriority = "fixed" | "high" | "medium" | "low";

export interface MemorySegmentSource {
  phase: string;
  injection_reason?: string;
  record_ids?: string[];
  record_count?: number;
}

export interface PromptSegment {
  kind: PromptSegmentKind;
  priority: PromptSegmentPriority;
  content: string;
  source?: MemorySegmentSource;
}

export interface PromptSegmentView {
  kind: PromptSegmentKind;
  priority: PromptSegmentPriority;
  preview: string;
  phase?: string;
  record_ids?: string[];
  record_count?: number;
}

export function promptSegmentToMessage(segment: PromptSegment): ChatMessage {
  return {
    role: "system",
    content: segment.content,
  };
}

export function compilePromptSegments(segments: PromptSegment[]): ChatMessage[] {
  return segments.map((segment) => promptSegmentToMessage(segment));
}

export function toPromptSegmentView(segment: PromptSegment): PromptSegmentView {
  return {
    kind: segment.kind,
    priority: segment.priority,
    preview: buildPreview(segment.content),
    phase: segment.source?.phase,
    record_ids: segment.source?.record_ids,
    record_count: segment.source?.record_count,
  };
}

function buildPreview(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= 160) {
    return normalized;
  }
  return `${normalized.slice(0, 157)}...`;
}
