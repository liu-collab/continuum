import { z } from "zod";

import type { AppConfig } from "../config.js";
import type {
  GovernanceExecutionItem,
  MemoryConflictSnapshot,
  MemoryRecordSnapshot,
} from "../shared/types.js";
import { callWritebackLlm, parseJsonPayload, type WritebackLlmConfig } from "./llm-extractor.js";
import { WRITEBACK_GOVERNANCE_VERIFY_SYSTEM_PROMPT } from "./llm-refiner-prompt.js";

const verifierResultSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  confidence: z.number().min(0).max(1),
  notes: z.string().min(1),
});

export type GovernanceVerifierResult = z.infer<typeof verifierResultSchema>;

export interface GovernanceVerifierInput {
  proposal: GovernanceExecutionItem;
  seed_records: MemoryRecordSnapshot[];
  related_records: MemoryRecordSnapshot[];
  open_conflicts: MemoryConflictSnapshot[];
}

export interface GovernanceVerifier {
  verify(input: GovernanceVerifierInput): Promise<GovernanceVerifierResult>;
}

type GovernanceVerifierConfig = WritebackLlmConfig &
  Pick<AppConfig, "WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS">;

export class HttpGovernanceVerifier implements GovernanceVerifier {
  constructor(private readonly config: GovernanceVerifierConfig) {}

  async verify(input: GovernanceVerifierInput): Promise<GovernanceVerifierResult> {
    const text = await callWritebackLlm(
      this.config,
      WRITEBACK_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      {
        proposal: input.proposal,
        seed_records: input.seed_records.map(toCompactRecord),
        related_records: input.related_records.map(toCompactRecord),
        open_conflicts: input.open_conflicts.map(toCompactConflict),
      },
      this.config.WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS,
    );

    const parsed = verifierResultSchema.safeParse(parseJsonPayload(text));
    if (!parsed.success) {
      throw new Error("governance verifier response did not match schema");
    }

    return parsed.data;
  }
}

function toCompactRecord(record: MemoryRecordSnapshot) {
  return {
    id: record.id,
    memory_type: record.memory_type,
    scope: record.scope,
    status: record.status,
    summary: record.summary,
    importance: record.importance,
    confidence: record.confidence,
    created_at: record.created_at,
    updated_at: record.updated_at,
  };
}

function toCompactConflict(conflict: MemoryConflictSnapshot) {
  return {
    id: conflict.id,
    record_id: conflict.record_id,
    conflict_with_record_id: conflict.conflict_with_record_id,
    conflict_type: conflict.conflict_type,
    conflict_summary: conflict.conflict_summary,
    created_at: conflict.created_at,
  };
}
