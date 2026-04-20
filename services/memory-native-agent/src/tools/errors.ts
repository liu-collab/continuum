export class ToolExecutionError extends Error {
  readonly code: string;
  readonly exitCode?: number;

  constructor(message: string, options?: { code?: string; exitCode?: number; cause?: unknown }) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.code = options?.code ?? "tool_execution_failed";
    this.exitCode = options?.exitCode;
  }
}

export class ToolInputError extends ToolExecutionError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "tool_invalid_input", cause });
  }
}

export class ToolPermissionError extends ToolExecutionError {
  constructor(message: string, code = "tool_denied", cause?: unknown) {
    super(message, { code, cause });
  }
}

export class ToolTimeoutError extends ToolExecutionError {
  constructor(message: string, cause?: unknown) {
    super(message, { code: "tool_timeout", cause });
  }
}

export class ToolPatternBlockedError extends ToolExecutionError {
  readonly pattern: string;

  constructor(pattern: string, message?: string) {
    super(message ?? `Command matched denied pattern: ${pattern}`, {
      code: "tool_denied_pattern",
    });
    this.pattern = pattern;
  }
}

export class ToolArtifactTooLargeError extends ToolExecutionError {
  constructor(message: string) {
    super(message, { code: "tool_output_too_large" });
  }
}
