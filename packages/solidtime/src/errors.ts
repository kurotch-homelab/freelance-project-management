export class SolidtimeApiError extends Error {
  readonly status: number | null;
  readonly detail: string | undefined;

  /** status is null for transport failures and timeouts; detail must be redacted. */
  constructor(status: number | null, detail?: string) {
    super(status === null ? "Solidtime request failed" : `Solidtime request failed (HTTP ${status})`);
    this.name = "SolidtimeApiError";
    this.status = status;
    this.detail = detail;
  }
}

export class SolidtimeAuthError extends SolidtimeApiError {
  constructor(detail?: string) {
    super(401, detail);
    this.name = "SolidtimeAuthError";
  }
}

export function assertResponse(condition: unknown, status: number, field: string): asserts condition {
  if (!condition) {
    // Never include response values, which may contain credentials, in diagnostics.
    throw new SolidtimeApiError(status, `Unexpected solidtime response: ${field}`);
  }
}
