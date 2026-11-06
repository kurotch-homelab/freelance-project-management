import type { createApp } from "@fpm/app";
import type { InvoiceGuide, InvoiceGuideInput } from "@fpm/domain";

export type Dashboard = Awaited<ReturnType<ReturnType<typeof createApp>["dashboard"]>>;
export type SyncSource = keyof Dashboard["sync"];
export type Client = Pick<InvoiceGuideInput["client"], "id" | "name">;
export type SyncResult =
  | { readonly kind: "ok" }
  | { readonly kind: "busy" }
  | { readonly kind: "failed"; readonly error: string };

export interface ApiClient {
  dashboard(): Promise<Dashboard>;
  listClients(): Promise<readonly Client[]>;
  invoiceGuide(query: { clientId: string; month: string }): Promise<InvoiceGuide | null>;
  sync(source: SyncSource): Promise<SyncResult>;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("ログインが必要です");
    this.name = "UnauthorizedError";
  }
}

async function responseError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // プロキシなどが JSON 以外を返す場合も、HTTP の失敗理由を保持する。
  }
  return `リクエストに失敗しました (HTTP ${response.status})`;
}

export function createApiClient({ fetch: fetcher = globalThis.fetch }: { fetch?: typeof fetch } = {}): ApiClient {
  async function request<T>(url: string): Promise<T> {
    const response = await fetcher(url, { method: "GET", credentials: "same-origin" });
    if (response.status === 401) throw new UnauthorizedError();
    if (!response.ok) throw new Error(await responseError(response));
    return response.json() as Promise<T>;
  }

  return {
    dashboard: () => request<Dashboard>("/api/dashboard"),
    listClients: () => request<readonly Client[]>("/api/clients"),
    async invoiceGuide(query) {
      const params = new URLSearchParams(query);
      const body = await request<{ guide: InvoiceGuide | null }>(`/api/invoice-guide?${params}`);
      return body.guide;
    },
    async sync(source) {
      let response: Response;
      try {
        response = await fetcher(`/api/sync/${source}`, { method: "POST", credentials: "same-origin" });
      } catch (error) {
        if (error instanceof UnauthorizedError) throw error;
        return { kind: "failed", error: error instanceof Error ? error.message : String(error) };
      }
      if (response.status === 401) throw new UnauthorizedError();
      if (response.status === 200) return { kind: "ok" };
      if (response.status === 409) return { kind: "busy" };
      const error = await responseError(response);
      // 401 / 409 以外の 4xx は、他の API と同じ Error の契約を優先する。
      if (response.status >= 400 && response.status < 500) throw new Error(error);
      return { kind: "failed", error };
    },
  };
}
