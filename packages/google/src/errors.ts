export class GoogleApiError extends Error {
  readonly status: number;

  /** status is 0 when no HTTP response was received. */
  constructor(status: number, message: string) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
  }
}

export class GoogleAuthError extends GoogleApiError {
  constructor(status = 401, message = "Unauthenticated.") {
    super(status, message);
    this.name = "GoogleAuthError";
  }
}

export function assertResponse(condition: unknown, status: number, field: string): asserts condition {
  if (!condition) {
    // Never include response values, which may contain credentials, in diagnostics.
    throw new GoogleApiError(status, `Unexpected Google response: ${field}`);
  }
}
