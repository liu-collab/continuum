import type { MnaAgentConfigResponse } from "./openapi-types";

export type ProviderKind = MnaAgentConfigResponse["provider"]["kind"];

export type EditableProviderKind = "openai-compatible" | "openai-responses" | "anthropic" | "ollama";

export const EDITABLE_PROVIDER_KIND_OPTIONS: Array<{
  value: EditableProviderKind;
  label: string;
}> = [
  {
    value: "openai-compatible",
    label: "OpenAI-compatible"
  },
  {
    value: "openai-responses",
    label: "OpenAI Responses"
  },
  {
    value: "anthropic",
    label: "anthropic"
  },
  {
    value: "ollama",
    label: "ollama"
  }
];

export function isEditableProviderKind(kind: ProviderKind): kind is EditableProviderKind {
  return kind === "openai-compatible" || kind === "openai-responses" || kind === "anthropic" || kind === "ollama";
}

export function formatProviderKindLabel(kind: string): string {
  if (kind === "openai-compatible") return "OpenAI-compatible";
  if (kind === "openai-responses") return "OpenAI Responses";
  return kind;
}
