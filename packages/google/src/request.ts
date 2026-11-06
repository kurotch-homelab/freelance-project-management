import { resolveAccessToken } from "./auth.ts";
import { assertResponse, GoogleApiError, GoogleAuthError } from "./errors.ts";
import { isRecord, parsePage } from "./responses.ts";
import type { GoogleClientOptions } from "./types.ts";

export function createGoogleRequest(options: GoogleClientOptions) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 30_000;

  return async function request<T>(
    url: URL,
    parse: (body: unknown, status: number) => T,
    init: RequestInit = {},
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new GoogleApiError(0, "Google request timed out"));
        controller.abort();
      }, timeoutMs);
    });
    try {
      // The provider cannot be aborted. Racing it also prevents a late token from starting a fetch.
      const token = await Promise.race([resolveAccessToken(options.getAccessToken), expired]);
      let response: Response;
      let text: string;
      try {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${token}`);
        headers.set("Accept", "application/json");
        [response, text] = await Promise.race([
          (async () => {
            const result = await fetcher(url.toString(), { ...init, headers, signal: controller.signal });
            return [result, await result.text()] as const;
          })(),
          expired,
        ]);
      } catch {
        // Transport/body exceptions may contain credentials; never retain the cause.
        throw new GoogleApiError(0, controller.signal.aborted ? "Google request timed out" : "Google request failed");
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
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
    } finally {
      clearTimeout(timer);
    }
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
