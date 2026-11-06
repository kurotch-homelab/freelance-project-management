import { describe, expect, it, vi } from "vitest";
import { createApiClient, UnauthorizedError } from "./api-client.ts";

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createApiClient: 画面から API を呼ぶ", () => {
  it("dashboard: GET /api/dashboard。Cookie を送る", async () => {
    const fetch = vi.fn(async () => response(200, { asOf: "2026-11-15", months: [], sync: {} }));
    await expect(createApiClient({ fetch }).dashboard()).resolves.toMatchObject({ asOf: "2026-11-15" });
    expect(fetch).toHaveBeenCalledWith("/api/dashboard", expect.objectContaining({ credentials: "same-origin" }));
  });

  it.each([
    [200, { ok: true, unlinked: [] }, { kind: "ok" }],
    [409, { ok: false, error: "busy" }, { kind: "busy" }],
    [502, { ok: false, error: "Solidtime request failed (HTTP 500)" }, { kind: "failed", error: "Solidtime request failed (HTTP 500)" }],
  ])("sync: 状態コード %i を結果に直す", async (status, body, expected) => {
    const fetch = vi.fn(async () => response(status, body));
    await expect(createApiClient({ fetch }).sync("solidtime")).resolves.toEqual(expected);
    expect(fetch).toHaveBeenCalledWith("/api/sync/solidtime", expect.objectContaining({ method: "POST" }));
  });

  it("invoiceGuide: クエリを付けて呼び、guide を返す", async () => {
    const fetch = vi.fn(async () => response(200, { guide: null }));
    await expect(createApiClient({ fetch }).invoiceGuide({ clientId: "a b", month: "2026-11" })).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith("/api/invoice-guide?clientId=a+b&month=2026-11", expect.anything());
  });

  it("401 は UnauthorizedError(画面はログインへ移る)", async () => {
    const fetch = vi.fn(async () => response(401, { error: "unauthorized" }));
    await expect(createApiClient({ fetch }).dashboard()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("400 はサーバーのメッセージつきのエラー", async () => {
    const fetch = vi.fn(async () => response(400, { error: "contracts overlap" }));
    await expect(createApiClient({ fetch }).listClients()).rejects.toThrow("contracts overlap");
  });

  it.each([
    ["listProjects", [], "/api/projects"],
    ["listProjects", ["client-a"], "/api/projects?clientId=client-a"],
    ["listContracts", [], "/api/contracts"],
  ] as const)("%s: GET %s", async (method, args, url) => {
    const fetch = vi.fn(async () => response(200, []));
    await (createApiClient({ fetch })[method] as (...a: readonly string[]) => Promise<unknown>)(...args);
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: "same-origin" }));
  });

  it("saveClient: PUT /api/clients/:id に JSON で送る(id はエンコードする)", async () => {
    const fetch = vi.fn(async () => response(200, { ok: true }));
    const client = { id: "a/b", name: "A 社" };
    await createApiClient({ fetch }).saveClient(client as never);
    expect(fetch).toHaveBeenCalledWith(
      "/api/clients/a%2Fb",
      expect.objectContaining({
        method: "PUT",
        credentials: "same-origin",
        headers: expect.objectContaining({ "content-type": "application/json" }),
        body: JSON.stringify(client),
      }),
    );
  });

  it("saveContract: 本文の pushRates を返す", async () => {
    const body = { ok: true, pushRates: { ok: false, error: "Solidtime request failed (HTTP 500)" } };
    const fetch = vi.fn(async () => response(200, body));
    await expect(createApiClient({ fetch }).saveContract({ id: "c1" } as never)).resolves.toEqual(body);
    expect(fetch).toHaveBeenCalledWith("/api/contracts/c1", expect.objectContaining({ method: "PUT" }));
  });

  it("保存の 400 はサーバーのメッセージつきのエラー、401 は UnauthorizedError", async () => {
    const bad = vi.fn(async () => response(400, { error: "contracts overlap" }));
    await expect(createApiClient({ fetch: bad }).saveProject({ id: "X" } as never)).rejects.toThrow("contracts overlap");
    const unauthorized = vi.fn(async () => response(401, { error: "unauthorized" }));
    await expect(createApiClient({ fetch: unauthorized }).saveProject({ id: "X" } as never)).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });
});

