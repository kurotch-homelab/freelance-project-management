import { UnauthorizedError } from "./api-client.ts";

export function redirectIfUnauthorized(error: unknown): boolean {
  if (!(error instanceof UnauthorizedError)) return false;
  window.location.assign("/auth/login");
  return true;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
