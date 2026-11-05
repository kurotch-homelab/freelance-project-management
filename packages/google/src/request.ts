import { resolveAccessToken } from "./auth.ts";
import { assertResponse, GoogleApiError, GoogleAuthError } from "./errors.ts";
import { isRecord, parsePage } from "./responses.ts";
import type { GoogleClientOptions } from "./types.ts";

export function createGoogleRequest(options: GoogleClientOptions) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);

  return async function request<T>(
    url: URL,
    parse: (body: unknown, status: number) => T,
    init: RequestInit = {},
  ): Promise<T> {
    const token = await resolveAccessToken(options.getAccessToken);
    let response: Response;
    try {
      const headers = new Headers(init.headers);
      headers.set("Authorization", `Bearer ${token}`);
      headers.set("Accept", "application/json");
      response = await fetcher(url.toString(), { ...init, headers });
    } catch {
      // Transport exceptions may include the authorization header; never retain the cause.
      throw new GoogleApiError(0, "Google request failed before receiving a response");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // Classify non-JSON errors by HTTP status, too.
    }
    if (!response.ok) {
      const message = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
        ? payload.error.message
        : `Google request failed (HTTP ${response.status})`;
      const safeMessage = message.replaceAll(token, "[REDACTED]");
      if (response.status === 401 || response.status === 403) throw new GoogleAuthError(response.status, safeMessage);
      throw new GoogleApiError(response.status, safeMessage);
    }
    return parse(payload, response.status);
  };
}

export async function* listGooglePages<T>(
  request: ReturnType<typeof createGoogleRequest>,
  url: URL,
  field: "items" | "files",
  parse: (value: unknown, status: number) => T,
): AsyncGenerator<T[]> {
  const seenTokens = new Set<string>();
  while (true) {
    const page = await request(url, (body, status) => {
      const { items, nextPageToken } = parsePage(body, status, field);
      if (nextPageToken !== undefined) {
        assertResponse(!seenTokens.has(nextPageToken), status, "repeated nextPageToken");
        seenTokens.add(nextPageToken);
      }
      return { items: items.map((value) => parse(value, status)), nextPageToken };
    });
    yield page.items;
    if (page.nextPageToken === undefined) return;
    url.searchParams.set("pageToken", page.nextPageToken);
  }
}
