import type { EmbeddingsClient } from "../query/embeddings-client.js";
import { cosineSimilarity } from "../shared/utils.js";

export interface CrossReferenceDraft {
  summary: string;
}

export interface CrossReferenceValidatedDraft<T extends CrossReferenceDraft> extends CrossReferenceDraft {
  cross_validated: boolean;
  cross_reference_idx?: number;
}

export interface CrossReferencePair {
  rule_idx: number;
  llm_idx: number;
  similarity: number;
  verdict: "independent_confirmation" | "partial_match" | "no_match";
}

export interface CrossReferenceResult<T extends CrossReferenceDraft> {
  rule_drafts: Array<T & CrossReferenceValidatedDraft<T>>;
  llm_drafts: Array<T & CrossReferenceValidatedDraft<T>>;
  cross_reference: CrossReferencePair[];
  degraded?: boolean;
  degradation_reason?: string;
}

export class EmbeddingCrossReferenceEngine {
  constructor(
    private readonly embeddingsClient: EmbeddingsClient,
    private readonly config: {
      confirmationThreshold: number;
      partialMatchThreshold: number;
    },
  ) {}

  async crossReference<T extends CrossReferenceDraft>(
    ruleDrafts: T[],
    llmDrafts: T[],
    signal?: AbortSignal,
  ): Promise<CrossReferenceResult<T>> {
    if (ruleDrafts.length === 0 || llmDrafts.length === 0) {
      return buildUnvalidatedCrossReference(ruleDrafts, llmDrafts);
    }

    const embeddings = await Promise.all(
      [...ruleDrafts, ...llmDrafts].map((draft) => this.embeddingsClient.embedText(draft.summary, signal)),
    );
    const ruleEmbeddings = embeddings.slice(0, ruleDrafts.length);
    const llmEmbeddings = embeddings.slice(ruleDrafts.length);
    const pairs: CrossReferencePair[] = [];
    const ruleValidated = new Map<number, number>();
    const llmValidated = new Map<number, number>();

    for (let ruleIndex = 0; ruleIndex < ruleDrafts.length; ruleIndex += 1) {
      for (let llmIndex = 0; llmIndex < llmDrafts.length; llmIndex += 1) {
        const similarity = cosineSimilarity(ruleEmbeddings[ruleIndex] ?? [], llmEmbeddings[llmIndex] ?? []);
        const verdict =
          similarity >= this.config.confirmationThreshold
            ? "independent_confirmation"
            : similarity >= this.config.partialMatchThreshold
              ? "partial_match"
              : "no_match";
        const pairIndex = pairs.length;
        pairs.push({
          rule_idx: ruleIndex,
          llm_idx: llmIndex,
          similarity,
          verdict,
        });

        if (verdict === "independent_confirmation") {
          ruleValidated.set(ruleIndex, pairIndex);
          llmValidated.set(llmIndex, pairIndex);
        }
      }
    }

    return {
      rule_drafts: ruleDrafts.map((draft, index) => ({
        ...draft,
        cross_validated: ruleValidated.has(index),
        cross_reference_idx: ruleValidated.get(index),
      })),
      llm_drafts: llmDrafts.map((draft, index) => ({
        ...draft,
        cross_validated: llmValidated.has(index),
        cross_reference_idx: llmValidated.get(index),
      })),
      cross_reference: pairs.sort((left, right) => right.similarity - left.similarity),
    };
  }
}

export function buildUnvalidatedCrossReference<T extends CrossReferenceDraft>(
  ruleDrafts: T[],
  llmDrafts: T[],
): CrossReferenceResult<T> {
  return {
    rule_drafts: ruleDrafts.map((draft) => ({
      ...draft,
      cross_validated: false,
    })),
    llm_drafts: llmDrafts.map((draft) => ({
      ...draft,
      cross_validated: false,
    })),
    cross_reference: [],
  };
}
