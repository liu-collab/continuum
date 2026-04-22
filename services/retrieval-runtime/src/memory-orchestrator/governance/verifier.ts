import type { AppConfig } from "../../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../llm-client.js";
import { MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT } from "../prompts.js";
import { memoryGovernanceVerificationSchema } from "../schemas.js";
import type { GovernanceVerificationResult, GovernanceVerifier, GovernanceVerifierInput } from "../types.js";

type GovernanceVerifierConfig = MemoryLlmConfig &
  Pick<AppConfig, "WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS">;

export class HttpMemoryGovernanceVerifier implements GovernanceVerifier {
  constructor(private readonly config: GovernanceVerifierConfig) {}

  async verify(input: GovernanceVerifierInput): Promise<GovernanceVerificationResult> {
    const text = await callMemoryLlm(
      this.config,
      MEMORY_GOVERNANCE_VERIFY_SYSTEM_PROMPT,
      {
        proposal: input.proposal,
        seed_records: input.seed_records.map(toCompactRecord),
        related_records: input.related_records.map(toCompactRecord),
        open_conflicts: input.open_conflicts.map(toCompactConflict),
      },
      this.config.WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS,
    );

    const parsed = memoryGovernanceVerificationSchema.safeParse(parseMemoryLlmJsonPayload(text));
    if (!parsed.success) {
      throw new Error("governance verifier response did not match schema");
    }

    return parsed.data;
  }
}

function toCompactRecord(record: GovernanceVerifierInput["seed_records"][number]) {
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

function toCompactConflict(conflict: GovernanceVerifierInput["open_conflicts"][number]) {
  return {
    id: conflict.id,
    record_id: conflict.record_id,
    conflict_with_record_id: conflict.conflict_with_record_id,
    conflict_type: conflict.conflict_type,
    conflict_summary: conflict.conflict_summary,
    created_at: conflict.created_at,
  };
}
