import type { AppConfig } from "../config.js";
import { callMemoryLlm, parseMemoryLlmJsonPayload, type MemoryLlmConfig } from "../memory-orchestrator/llm-client.js";
import { HttpMemoryWritebackPlanner } from "../memory-orchestrator/writeback/planner.js";
import type {
  RuleCandidateDigest,
  WritebackExtractionCandidate,
  WritebackExtractionResult,
  WritebackPlanner,
  WritebackRefineInput,
  WritebackRefineItem,
  WritebackRefineResult,
} from "../memory-orchestrator/types.js";

export type LlmExtractionCandidate = WritebackExtractionCandidate;
export type LlmExtractionResult = WritebackExtractionResult;
export type LlmRefineItem = WritebackRefineItem;
export type LlmRefineResult = WritebackRefineResult;
export type LlmRefineInput = WritebackRefineInput;
export type { RuleCandidateDigest };

export interface LlmExtractor extends WritebackPlanner {}

export type WritebackLlmConfig = MemoryLlmConfig;
export const callWritebackLlm = callMemoryLlm;
export const parseJsonPayload = parseMemoryLlmJsonPayload;

export class HttpLlmExtractor extends HttpMemoryWritebackPlanner {
  constructor(config: AppConfig) {
    super(config);
  }
}
