import type { createApp } from "@fpm/app";
import type { ClientBilling, ClientRecord, ProjectRecord, HoursRangeOverrideFilter, HoursRangeOverrideKey, HoursRangeOverrideRecord } from "@fpm/db";
import type { Contract, InvoiceGuide } from "@fpm/domain";

export type Dashboard = Awaited<ReturnType<ReturnType<typeof createApp>["dashboard"]>>;
export type SyncSource = keyof Dashboard["sync"];
export type Client = ClientRecord;
export type Project = ProjectRecord;
export type { Contract } from "@fpm/domain";
export type { HoursRangeOverrideKey, HoursRangeOverrideRecord } from "@fpm/db";
export type SyncResult =
  | { readonly kind: "ok" }
  | { readonly kind: "busy" }
  | { readonly kind: "failed"; readonly error: string };

export interface ApiClient {
  dashboard(): Promise<Dashboard>;
  listClients(): Promise<readonly Client[]>;
  listProjects(options?: { clientId?: string; includeArchived?: boolean }): Promise<readonly Project[]>;
  listContracts(clientId?: string): Promise<readonly Contract[]>;
  saveClientBilling(id: string, billing: ClientBilling): Promise<void>;
  saveContract(contract: Contract): Promise<void>;
  listHoursRangeOverrides(filter?: HoursRangeOverrideFilter): Promise<readonly HoursRangeOverrideRecord[]>;
  saveHoursRangeOverride(override: HoursRangeOverrideRecord): Promise<void>;
  deleteHoursRangeOverride(key: HoursRangeOverrideKey): Promise<void>;
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
  async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
    const response = await fetcher(url, { method: "GET", ...options, credentials: "same-origin" });
    if (response.status === 401) throw new UnauthorizedError();
    if (!response.ok) throw new Error(await responseError(response));
    return response.json() as Promise<T>;
  }

  function list<T>(resource: string, clientId?: string): Promise<readonly T[]> {
    const query = clientId === undefined ? "" : `?${new URLSearchParams({ clientId })}`;
    return request(`/api/${resource}${query}`);
  }

  function save<T>(resource: string, record: { readonly id: string }): Promise<T> {
    return request(`/api/${resource}/${encodeURIComponent(record.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(record),
    });
  }

  return {
    dashboard: () => request<Dashboard>("/api/dashboard"),
    listClients: () => request<readonly Client[]>("/api/clients"),
    listProjects: (options = {}) => {
      const params = new URLSearchParams();
      if (options.clientId !== undefined) params.set("clientId", options.clientId);
      if (options.includeArchived !== undefined) params.set("includeArchived", String(options.includeArchived));
      return request(`/api/projects${params.size ? `?${params}` : ""}`);
    },
    listContracts: (clientId) => list<Contract>("contracts", clientId),
    async saveClientBilling(id, billing) {
      await request(`/api/clients/${encodeURIComponent(id)}/billing`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(billing),
      });
    },
    async saveContract(contract) { await save<{ ok: true }>("contracts", contract); },
    listHoursRangeOverrides: (filter = {}) => {
      const params = new URLSearchParams();
      if (filter.contractId !== undefined) params.set("contractId", filter.contractId);
      if (filter.month !== undefined) params.set("month", filter.month);
      return request(`/api/hours-range-overrides${params.size ? `?${params}` : ""}`);
    },
    async saveHoursRangeOverride(override) {
      await request("/api/hours-range-overrides", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(override),
      });
    },
    async deleteHoursRangeOverride({ contractId, projectId, month }) {
      const params = new URLSearchParams({ contractId });
      if (projectId !== null) params.set("projectId", projectId);
      params.set("month", month);
      await request(`/api/hours-range-overrides?${params}`, { method: "DELETE" });
    },
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
