export class MemoryClientError extends Error {
  readonly code: string;
  readonly statusCode?: number;
  readonly serviceCode?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    options?: {
      code?: string;
      statusCode?: number;
      serviceCode?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.code = options?.code ?? "memory_client_error";
    this.statusCode = options?.statusCode;
    this.serviceCode = options?.serviceCode;
    this.details = options?.details;
  }
}

export class MemoryTimeoutError extends MemoryClientError {
  constructor(message: string, options?: { details?: unknown; cause?: unknown }) {
    super(message, {
      code: "memory_timeout",
      details: options?.details,
      cause: options?.cause,
    });
  }
}

export class MemoryBadRequestError extends MemoryClientError {
  constructor(
    message: string,
    options?: {
      statusCode?: number;
      serviceCode?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "memory_bad_request",
      statusCode: options?.statusCode,
      serviceCode: options?.serviceCode,
      details: options?.details,
      cause: options?.cause,
    });
  }
}

export class MemoryUnavailableError extends MemoryClientError {
  constructor(
    message: string,
    options?: {
      statusCode?: number;
      serviceCode?: string;
      details?: unknown;
      cause?: unknown;
    },
  ) {
    super(message, {
      code: "memory_unavailable",
      statusCode: options?.statusCode,
      serviceCode: options?.serviceCode,
      details: options?.details,
      cause: options?.cause,
    });
  }
}
