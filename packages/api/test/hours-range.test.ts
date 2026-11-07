import { createDatabase, createRepository, migrateToLatest, type Database, type Repository } from "@fpm/db";
import type { MiddlewareHandler } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApi, type ApiDeps } from "../src/index.ts";

// 月ごとの目安時間の上書き: 契約で絞って読む、追加する、消す
const allow: MiddlewareHandler = async (_c, next) => next();
const json = (body: unknown, method = "POST") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const contract = (id: string, projectIds: string[]) => ({
  id,
  clientId: "st-client-a",
  name: `契約 ${id}`,
  start: id === "c1" ? "2026-01-01" : "2027-01-01",
  end: id === "c1" ? "2026-12-31" : null,
  projectIds,
  renewalOutlook: "undecided" as const,
});

describe("月ごとの目安時間の上書き", () => {
  let db: Database;
  let repo: Repository;
  let api: ReturnType<typeof createApi>;

  beforeEach(async () => {
    db = await createDatabase({ kind: "sqlite", filename: ":memory:" });
    await migrateToLatest(db);
    repo = createRepository(db);
    api = createApi({ repo, app: {} as ApiDeps["app"], auth: allow });
    await repo.syncSolidtimeCatalog({
      clients: [{ id: "st-client-a", name: "A 社", archived: false }],
      projects: [
        { id: "X", clientId: "st-client-a", name: "案件 X", archived: false, hourlyRate: 5_000 },
        { id: "Y", clientId: "st-client-a", name: "案件 Y", archived: false, hourlyRate: 5_000 },
      ],
    });
    await repo.saveContract(contract("c1", ["X"]));
    await repo.saveContract(contract("c2", ["Y"]));
  });

  afterEach(async () => {
    await db.destroy();
  });

  const c1Whole = { contractId: "c1", projectId: null, month: "2026-12", range: { maxHours: 200 }, note: "年末" };
  const c1X = { contractId: "c1", projectId: "X", month: "2026-12", range: { minHours: 10 }, note: "" };
  const c2Whole = { contractId: "c2", projectId: null, month: "2027-01", range: { minHours: 100 }, note: "休暇" };

  it("GET ?contractId= で、その契約の上書きだけを読む", async () => {
    for (const o of [c1Whole, c1X, c2Whole]) expect((await api.request("/api/hours-range-overrides", json(o))).status).toBe(200);
    const res = await api.request("/api/hours-range-overrides?contractId=c1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);
    expect(body).toEqual(expect.arrayContaining([c1Whole, c1X]));
  });

  it("DELETE で、契約全体の上書きを消す(案件の上書きは残る)", async () => {
    for (const o of [c1Whole, c1X]) await api.request("/api/hours-range-overrides", json(o));
    const res = await api.request("/api/hours-range-overrides?contractId=c1&month=2026-12", { method: "DELETE" });
    expect(res.status).toBe(200);
    await expect((await api.request("/api/hours-range-overrides?contractId=c1")).json()).resolves.toEqual([c1X]);
  });

  it("DELETE ?projectId= で、案件の上書きを消す", async () => {
    for (const o of [c1Whole, c1X]) await api.request("/api/hours-range-overrides", json(o));
    await api.request("/api/hours-range-overrides?contractId=c1&projectId=X&month=2026-12", { method: "DELETE" });
    await expect((await api.request("/api/hours-range-overrides?contractId=c1")).json()).resolves.toEqual([c1Whole]);
  });

  it("ない上書きの DELETE は 404", async () => {
    expect((await api.request("/api/hours-range-overrides?contractId=c1&month=2026-11", { method: "DELETE" })).status).toBe(404);
  });

  it("DELETE の month の形が不正なら 400", async () => {
    expect((await api.request("/api/hours-range-overrides?contractId=c1&month=2026-1", { method: "DELETE" })).status).toBe(400);
  });

  it("契約に入っていない案件の上書きは 400", async () => {
    expect((await api.request("/api/hours-range-overrides", json({ ...c1X, projectId: "Y" }))).status).toBe(400);
  });

  it("下限も上限もない上書きは 400", async () => {
    expect((await api.request("/api/hours-range-overrides", json({ ...c1Whole, range: {} }))).status).toBe(400);
  });
});
