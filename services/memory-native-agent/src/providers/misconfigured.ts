import {
  ProviderAuthError,
  type ChatChunk,
  type ChatRequest,
  type IModelProvider,
} from "./types.js";

type MisconfiguredProviderOptions = {
  kind: string;
  model: string;
  detail: string;
};

export class MisconfiguredProvider implements IModelProvider {
  constructor(private readonly options: MisconfiguredProviderOptions) {}

  id(): string {
    return this.options.kind;
  }

  model(): string {
    return this.options.model;
  }

  status() {
    return {
      status: "misconfigured" as const,
      detail: this.options.detail,
    };
  }

  async *chat(_request: ChatRequest): AsyncIterable<ChatChunk> {
    throw new ProviderAuthError(this.options.detail);
  }
}
