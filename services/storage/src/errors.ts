export class AppError extends Error {
  readonly code: string;
  readonly status_code: number;
  readonly details?: unknown;

  constructor(
    code: string,
    message: string,
    status_code = 400,
    details?: unknown,
  ) {
    super(message);
    this.code = code;
    this.status_code = status_code;
    this.details = details;
  }
}

export class DependencyUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super("dependency_unavailable", message, 503, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super("not_found", message, 404, details);
  }
}

export class ConflictResolutionError extends AppError {
  constructor(message: string, details?: unknown) {
    super("conflict_resolution_failed", message, 409, details);
  }
}
