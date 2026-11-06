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
});
