import { GoogleAuth } from "google-auth-library";
import { GoogleAuthError } from "./errors.ts";
import type { AccessTokenProvider } from "./types.ts";

export async function resolveAccessToken(provider: () => Promise<string | null | undefined>): Promise<string> {
  let token: string | null | undefined;
  try {
    token = await provider();
  } catch {
    // Provider exceptions can contain credentials; do not retain their message or cause.
    throw new GoogleAuthError(0, "Failed to obtain a Google access token");
  }
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new GoogleAuthError(0, "Google credentials did not provide an access token");
  }
  return token;
}

/** ADC reads WIF configuration or a service account key via GOOGLE_APPLICATION_CREDENTIALS. */
export function createAdcTokenProvider(scopes: string | readonly string[]): AccessTokenProvider {
  const auth = new GoogleAuth({ scopes: typeof scopes === "string" ? scopes : [...scopes] });
  // Reuse GoogleAuth so its client handles token caching and refresh.
  return () => resolveAccessToken(() => auth.getAccessToken());
}
