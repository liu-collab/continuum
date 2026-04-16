export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(message: string, options?: { code?: string; statusCode?: number; details?: unknown; expose?: boolean }) {
    super(message);
    this.name = this.constructor.name;
    this.code = options?.code ?? "internal_error";
    this.statusCode = options?.statusCode ?? 500;
    this.details = options?.details;
    this.expose = options?.expose ?? this.statusCode < 500;
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "configuration_error", statusCode: 500, details, expose: true });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "validation_error", statusCode: 400, details, expose: true });
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "dependency_unavailable", statusCode: 503, details, expose: true });
  }
}

export class TimeoutAppError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, { code: "dependency_timeout", statusCode: 504, details, expose: true });
  }
}
