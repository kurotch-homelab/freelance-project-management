import { createDatabase, createRepository, migrateToLatest, type Database, type Repository } from "@fpm/db";
import type { MiddlewareHandler } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApi, type ApiDeps } from "../src/index.ts";

const clientA = {
  id: "client-a",
  name: "A 社",
  paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
  subjectTemplate: "{YYYY}年{M}月分 業務委託料",
  lineGrouping: "project",
  solidtimeClientId: null,
  driveFolderId: null,
};

const projectX = {
  id: "X",
  clientId: "client-a",
  name: "案件 X",
  status: "active",
  solidtimeProjectId: "st-x",
  driveFolderId: null,
};

const contract1 = {
  id: "c1",
  clientId: "client-a",
  name: "業務委託契約",
  start: "2026-01-01",
  end: null,
  hourlyRate: 5_000,
  projectIds: ["X"],
  projectRates: {},
  hoursRange: { minHours: 140, maxHours: 180 },
  renewalOutlook: "undecided",
};

/** 認証済みとして通すミドルウェア(OIDC は別の層で作る) */
const allow: MiddlewareHandler = async (_c, next) => next();
/** 未ログインとして弾くミドルウェア */
const deny: MiddlewareHandler = async (c) => c.json({ error: "unauthorized" }, 401);

const json = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("createApi: HTTP API", () => {
  let db: Database;
  let repo: Repository;
  let useCases: ApiDeps["app"];
  let api: ReturnType<typeof createApi>;

  const build = (auth: MiddlewareHandler = allow) => createApi({ repo, app: useCases, auth });

  beforeEach(async () => {
    db = await createDatabase({ kind: "sqlite", filename: ":memory:" });
    await migrateToLatest(db);
    repo = createRepository(db);
    useCases = {
      syncSolidtime: vi.fn(async () => ({ ok: true as const, unlinked: [] })),
      syncCalendar: vi.fn(async () => ({ ok: true as const })),
      pushRates: vi.fn(async () => ({ pushed: [], skipped: [] })),
      dashboard: vi.fn(async () => ({ asOf: "2026-11-15", months: [], sync: {} })),
      invoiceGuide: vi.fn(async () => null),
      ensureProjectFolder: vi.fn(async () => ({ folderId: "folder-x" })),
      uploadDocument: vi.fn(async () => ({ fileId: "file-1", webViewLink: "https://drive.google.com/file-1" })),
    } as unknown as ApiDeps["app"];
    api = build();
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("認証", () => {
    it("/api/health は認証なしで 200", async () => {
      const res = await build(deny).request("/api/health");
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });
    });

    it("ほかの /api は認証のミドルウェアを通す", async () => {
      const res = await build(deny).request("/api/clients");
      expect(res.status).toBe(401);
    });
  });

  describe("取引先・案件・契約", () => {
    it("PUT で保存して GET で読む", async () => {
      expect((await api.request("/api/clients/client-a", { ...json(clientA), method: "PUT" })).status).toBe(200);
      expect((await api.request("/api/projects/X", { ...json(projectX), method: "PUT" })).status).toBe(200);
      expect((await api.request("/api/contracts/c1", { ...json(contract1), method: "PUT" })).status).toBe(200);
      await expect((await api.request("/api/clients")).json()).resolves.toEqual([clientA]);
      await expect((await api.request("/api/projects?clientId=client-a")).json()).resolves.toEqual([projectX]);
      await expect((await api.request("/api/contracts")).json()).resolves.toEqual([contract1]);
    });

    it("URL の id と本文の id が違えば 400", async () => {
      const res = await api.request("/api/clients/other", { ...json(clientA), method: "PUT" });
      expect(res.status).toBe(400);
    });

    it("形が正しくない本文は 400(項目の不足、型の違い)", async () => {
      const missing = await api.request("/api/clients/client-a", { ...json({ id: "client-a" }), method: "PUT" });
      expect(missing.status).toBe(400);
      const wrongType = await api.request("/api/contracts/c1", {
        ...json({ ...contract1, hourlyRate: "5000" }),
        method: "PUT",
      });
      expect(wrongType.status).toBe(400);
    });

    it("ドメインの検証で弾かれたら 400 とメッセージ", async () => {
      await api.request("/api/clients/client-a", { ...json(clientA), method: "PUT" });
      await api.request("/api/projects/X", { ...json(projectX), method: "PUT" });
      await api.request("/api/contracts/c1", { ...json(contract1), method: "PUT" });
      const res = await api.request("/api/contracts/c2", { ...json({ ...contract1, id: "c2" }), method: "PUT" });
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({ error: expect.any(String) });
    });

    it("ない取引先は 404", async () => {
      expect((await api.request("/api/clients/nope")).status).toBe(404);
    });

    it("月の目安時間の上書きを保存して、月で読む", async () => {
      await api.request("/api/clients/client-a", { ...json(clientA), method: "PUT" });
      await api.request("/api/projects/X", { ...json(projectX), method: "PUT" });
      await api.request("/api/contracts/c1", { ...json(contract1), method: "PUT" });
      const override = { contractId: "c1", projectId: null, month: "2026-12", range: { maxHours: 200 }, note: "年末" };
      expect((await api.request("/api/hours-range-overrides", json(override))).status).toBe(200);
      await expect((await api.request("/api/hours-range-overrides?month=2026-12")).json()).resolves.toEqual([override]);
    });

    it("契約の単価を solidtime に反映する", async () => {
      const res = await api.request("/api/contracts/c1/push-rates", { method: "POST" });
      expect(res.status).toBe(200);
      expect(useCases.pushRates).toHaveBeenCalledWith("c1");
    });
  });

  describe("同期", () => {
    it("POST /api/sync/solidtime は結果を返す", async () => {
      const res = await api.request("/api/sync/solidtime", { method: "POST" });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true, unlinked: [] });
    });

    it("実行中(busy)なら 409", async () => {
      vi.mocked(useCases.syncCalendar).mockResolvedValueOnce({ ok: false, error: "busy" });
      expect((await api.request("/api/sync/calendar", { method: "POST" })).status).toBe(409);
    });

    it("同期の失敗は 502 とメッセージ", async () => {
      vi.mocked(useCases.syncSolidtime).mockResolvedValueOnce({ ok: false, error: "Solidtime request failed (HTTP 500)" });
      const res = await api.request("/api/sync/solidtime", { method: "POST" });
      expect(res.status).toBe(502);
      await expect(res.json()).resolves.toEqual({ ok: false, error: "Solidtime request failed (HTTP 500)" });
    });
  });

  describe("ダッシュボード・請求書ガイド", () => {
    it("GET /api/dashboard", async () => {
      await expect((await api.request("/api/dashboard")).json()).resolves.toMatchObject({ asOf: "2026-11-15" });
    });

    it("GET /api/invoice-guide?clientId&month", async () => {
      const res = await api.request("/api/invoice-guide?clientId=client-a&month=2026-11");
      expect(res.status).toBe(200);
      expect(useCases.invoiceGuide).toHaveBeenCalledWith({ clientId: "client-a", month: "2026-11" });
      await expect(res.json()).resolves.toEqual({ guide: null });
    });

    it("month の形が不正なら 400", async () => {
      expect((await api.request("/api/invoice-guide?clientId=client-a&month=2026-1")).status).toBe(400);
    });

    it("ユースケースが RangeError を投げたら 400", async () => {
      vi.mocked(useCases.invoiceGuide).mockRejectedValueOnce(new RangeError("client not found"));
      expect((await api.request("/api/invoice-guide?clientId=nope&month=2026-11")).status).toBe(400);
    });
  });

  describe("書類のアップロード", () => {
    it("multipart の file を案件のフォルダにアップロードする", async () => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array([1, 2, 3])], "請求書_2026-11.pdf", { type: "application/pdf" }));
      const res = await api.request("/api/projects/X/documents", { method: "POST", body: form });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ fileId: "file-1", webViewLink: "https://drive.google.com/file-1" });
      expect(useCases.uploadDocument).toHaveBeenCalledWith({
        projectId: "X",
        name: "請求書_2026-11.pdf",
        mimeType: "application/pdf",
        data: new Uint8Array([1, 2, 3]),
      });
    });

    it("file がなければ 400", async () => {
      const res = await api.request("/api/projects/X/documents", { method: "POST", body: new FormData() });
      expect(res.status).toBe(400);
    });

    it("20 MB を超えるファイルは 413", async () => {
      const form = new FormData();
      form.append("file", new File([new Uint8Array(20 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" }));
      expect((await api.request("/api/projects/X/documents", { method: "POST", body: form })).status).toBe(413);
    });
  });

  describe("想定外のエラー", () => {
    it("500 と固定のメッセージ(中身は出さない)", async () => {
      vi.mocked(useCases.dashboard).mockRejectedValueOnce(new Error("secret internal detail"));
      const res = await api.request("/api/dashboard");
      expect(res.status).toBe(500);
      const body = await res.text();
      expect(body).not.toContain("secret internal detail");
    });
  });
});
