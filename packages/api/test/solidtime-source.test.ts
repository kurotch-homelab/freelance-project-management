import { createDatabase, createRepository, migrateToLatest, type Database, type Repository } from "@fpm/db";
import type { MiddlewareHandler } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApi, type ApiDeps } from "../src/index.ts";

// 取引先・案件は solidtime から取り込むので、API で作ったり変えたりしない(請求の設定と契約だけ)
const allow: MiddlewareHandler = async (_c, next) => next();
const json = (body: unknown, method = "PUT") => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const billing = {
  paymentTerms: { closingDay: 20, paymentMonthOffset: 2, paymentDay: 10 },
  subjectTemplate: "{M}月分",
  lineGrouping: "contract",
};
const contract = {
  id: "c1",
  clientId: "st-client-a",
  name: "業務委託契約",
  start: "2026-01-01",
  end: null,
  projectIds: ["st-x"],
  hoursRange: { minHours: 140 },
  renewalOutlook: "undecided",
};

describe("createApi: solidtime を正とする形", () => {
  let db: Database;
  let repo: Repository;
  let useCases: ApiDeps["app"];
  let api: ReturnType<typeof createApi>;

  beforeEach(async () => {
    db = await createDatabase({ kind: "sqlite", filename: ":memory:" });
    await migrateToLatest(db);
    repo = createRepository(db);
    useCases = {
      syncSolidtime: vi.fn(async () => ({ ok: true as const, unlinked: [] })),
      syncCalendar: vi.fn(async () => ({ ok: true as const })),
      updateClientBilling: vi.fn(async () => undefined),
      dashboard: vi.fn(async () => ({})),
      invoiceGuide: vi.fn(async () => null),
      ensureProjectFolder: vi.fn(async () => ({ folderId: "f" })),
      uploadDocument: vi.fn(async () => ({ fileId: "x", webViewLink: "https://drive.google.com/x" })),
    } as unknown as ApiDeps["app"];
    api = createApi({ repo, app: useCases, auth: allow });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("PUT /api/clients/:id/billing で請求の設定だけを変える", async () => {
    const res = await api.request("/api/clients/st-client-a/billing", json(billing));
    expect(res.status).toBe(200);
    expect(useCases.updateClientBilling).toHaveBeenCalledWith("st-client-a", billing);
  });

  it("請求の設定の形が正しくなければ 400", async () => {
    const res = await api.request("/api/clients/st-client-a/billing", json({ ...billing, lineGrouping: "both" }));
    expect(res.status).toBe(400);
    expect(useCases.updateClientBilling).not.toHaveBeenCalled();
  });

  it.each([
    { ...billing, paymentTerms: { closingDay: 31, paymentMonthOffset: 0, paymentDay: 1 } },
    { ...billing, paymentTerms: { closingDay: "end", paymentMonthOffset: 0, paymentDay: 30 } },
    { ...billing, subjectTemplate: " \t\n " },
  ])("請求できなくなる設定を API で拒否して更新しない: %o", async (invalidBilling) => {
    const res = await api.request("/api/clients/st-client-a/billing", json(invalidBilling));
    expect(res.status).toBe(400);
    expect(useCases.updateClientBilling).not.toHaveBeenCalled();
  });

  it("ない取引先の請求の設定は 404", async () => {
    vi.mocked(useCases.updateClientBilling).mockRejectedValueOnce(new RangeError("Client not found: nope"));
    expect((await api.request("/api/clients/nope/billing", json(billing))).status).toBe(404);
  });

  it.each([
    ["PUT", "/api/clients/st-client-a"],
    ["PUT", "/api/projects/st-x"],
    ["POST", "/api/contracts/c1/push-rates"],
  ])("%s %s は使えない(取引先・案件は solidtime で変える。単価も反映しない)", async (method, path) => {
    const res = await api.request(path, json({}, method));
    expect([404, 405]).toContain(res.status);
  });

  it("契約は単価なしで保存できる。solidtime への反映の結果は返さない", async () => {
    await repo.syncSolidtimeCatalog({
      clients: [{ id: "st-client-a", name: "A 社", archived: false }],
      projects: [{ id: "st-x", clientId: "st-client-a", name: "案件 X", archived: false, hourlyRate: 5_000 }],
    });
    const res = await api.request("/api/contracts/c1", json(contract));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    await expect((await api.request("/api/contracts")).json()).resolves.toEqual([contract]);
  });

  it("GET /api/projects はアーカイブした案件を除く。includeArchived=true なら含める", async () => {
    await repo.syncSolidtimeCatalog({
      clients: [{ id: "st-client-a", name: "A 社", archived: false }],
      projects: [
        { id: "st-x", clientId: "st-client-a", name: "案件 X", archived: false, hourlyRate: 5_000 },
        { id: "st-old", clientId: "st-client-a", name: "案件 old", archived: true, hourlyRate: 5_000 },
      ],
    });
    const active = (await (await api.request("/api/projects")).json()) as { id: string }[];
    expect(active.map((p) => p.id)).toEqual(["st-x"]);
    const all = (await (await api.request("/api/projects?includeArchived=true")).json()) as { id: string }[];
    expect(all.map((p) => p.id).sort()).toEqual(["st-old", "st-x"]);
  });
});
