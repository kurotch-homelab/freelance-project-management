export class SolidtimeApiError extends Error {
  readonly status: number;

  /** status is 0 when no HTTP response was received. */
  constructor(status: number, message: string) {
    super(message);
    this.name = "SolidtimeApiError";
    this.status = status;
  }
}

export class SolidtimeAuthError extends SolidtimeApiError {
  constructor(message = "Unauthenticated.") {
    super(401, message);
    this.name = "SolidtimeAuthError";
  }
}

export function assertResponse(condition: unknown, status: number, field: string): asserts condition {
  if (!condition) {
    // Never include response values, which may contain credentials, in diagnostics.
    throw new SolidtimeApiError(status, `Unexpected solidtime response: ${field}`);
  }
}
