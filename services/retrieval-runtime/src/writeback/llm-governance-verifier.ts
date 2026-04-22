import type { AppConfig } from "../config.js";
import { HttpMemoryGovernanceVerifier } from "../memory-orchestrator/governance/verifier.js";
import type { MemoryLlmConfig } from "../memory-orchestrator/llm-client.js";
import type {
  GovernanceVerificationResult,
  GovernanceVerifier,
  GovernanceVerifierInput,
} from "../memory-orchestrator/types.js";

export type GovernanceVerifierResult = GovernanceVerificationResult;
export type { GovernanceVerifier, GovernanceVerifierInput };

type GovernanceVerifierConfig = MemoryLlmConfig &
  Pick<AppConfig, "WRITEBACK_GOVERNANCE_VERIFY_MAX_TOKENS">;

export class HttpGovernanceVerifier extends HttpMemoryGovernanceVerifier {
  constructor(config: GovernanceVerifierConfig) {
    super(config);
  }
}
