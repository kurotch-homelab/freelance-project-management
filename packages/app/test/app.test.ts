import type { Contract } from "@fpm/domain";
import { createDatabase, createRepository, migrateToLatest, type Database, type Repository } from "@fpm/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "../src/index.ts";

const HOUR = 3_600;

// 今は 2026-11-15(日)12:00(日本時間)
const NOW = new Date("2026-11-15T03:00:00Z");

const clientA = {
  id: "client-a",
  name: "A 社",
  paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
  subjectTemplate: "{YYYY}年{M}月分 業務委託料",
  lineGrouping: "project",
  archived: false,
  driveFolderId: null,
} as const;

const projectX = {
  id: "X",
  clientId: "client-a",
  name: "案件 X",
  archived: false,
  hourlyRate: 5_000,
  driveFolderId: null,
} as const;
const projectY = { ...projectX, id: "Y", name: "案件 Y", hourlyRate: 7_000 } as const;

const contract1: Contract = {
  id: "c1",
  clientId: "client-a",
  name: "業務委託契約",
  start: "2026-01-01",
  end: null,
  projectIds: ["X", "Y"],

  hoursRange: { minHours: 140, maxHours: 180 },
  renewalOutlook: "undecided",
};

/** solidtime の打刻(フェイクが返す形) */
const stEntry = (id: string, projectId: string | null, date: string, seconds: number, billable = true) => ({
  id,
  projectId,
  date,
  seconds,
  billable,
  start: `${date}T00:00:00Z`,
  end: `${date}T01:00:00Z`,
  description: null,
});

/** 直近 8 週の月曜(11/09 から 7 日ずつさかのぼる) */
const mondays = ["2026-11-09", "2026-11-02", "2026-10-26", "2026-10-19", "2026-10-12", "2026-10-05", "2026-09-28", "2026-09-21"];

const fakes = () => ({
  solidtime: {
    listTimeEntries: vi.fn(async () => mondays.map((d, i) => stEntry(`e${i}`, "X", d, 4 * HOUR))),
    listClients: vi.fn(async () => [{ id: clientA.id, name: clientA.name, isArchived: false }]),
    listProjectsWithRates: vi.fn(async () => [projectX, projectY].map((p) => ({
      ...p, isArchived: p.archived, color: "#ef5350", isBillable: true, isPublic: false, estimatedTime: null,
    }))),
  },
  calendar: {
    listOutOfOffice: vi.fn(async () => [
      { start: { dateTime: "2026-11-16T13:00:00+09:00" }, end: { dateTime: "2026-11-16T15:00:00+09:00" } },
    ]),
  },
  drive: {
    ensureFolder: vi.fn(async ({ name }: { parentId: string; name: string }) => ({ id: `folder:${name}`, name })),
    uploadFile: vi.fn(async ({ name }: { name: string }) => ({
      id: `file:${name}`,
      name,
      webViewLink: `https://drive.google.com/${name}`,
    })),
    listFiles: vi.fn(async () => []),
  },
});

describe("createApp: ユースケース", () => {
  let db: Database;
  let repo: Repository;
  let f: ReturnType<typeof fakes>;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = await createDatabase({ kind: "sqlite", filename: ":memory:" });
    await migrateToLatest(db);
    repo = createRepository(db);
    await repo.syncSolidtimeCatalog({ clients: [clientA], projects: [projectX, projectY] });
    await repo.saveContract(contract1);
    f = fakes();
    const deps: AppDeps = {
      repo,
      solidtime: f.solidtime,
      calendar: f.calendar,
      drive: f.drive,
      clock: { now: () => NOW },
      config: { timeZone: "Asia/Tokyo", forecastWeeks: 8, forecastMonths: 3, driveRootFolderId: "root" },
    };
    app = createApp(deps);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("syncSolidtime: solidtime の打刻を取り込む", () => {
    it("予測に使う直近 N 週と先月の初めのうち早いほうから、今日までを取り込む", async () => {
      await app.syncSolidtime();
      expect(f.solidtime.listTimeEntries).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-09-20", to: "2026-11-15" }),
      );
      await expect(repo.listDailyWork({ from: "2026-09-20", to: "2026-11-15" })).resolves.toHaveLength(8);
    });

    it("成功を記録し、案件に結びついていない solidtime のプロジェクトを返す", async () => {
      f.solidtime.listTimeEntries.mockResolvedValueOnce([
        stEntry("a", "X", "2026-11-10", HOUR),
        stEntry("b", "st-unknown", "2026-11-10", 2 * HOUR),
      ]);
      const result = await app.syncSolidtime();
      expect(result).toEqual({ ok: true, unlinked: [{ solidtimeProjectId: "st-unknown", seconds: 2 * HOUR }] });
      await expect(repo.getSyncStatus("solidtime")).resolves.toMatchObject({ lastSuccessAt: NOW.toISOString() });
    });

    it("失敗したら前に取り込んだ分は残し、失敗を記録して返す(例外にしない)", async () => {
      await app.syncSolidtime();
      f.solidtime.listTimeEntries.mockRejectedValueOnce(new Error("Solidtime request failed (HTTP 500)"));
      await expect(app.syncSolidtime()).resolves.toEqual({ ok: false, error: "Solidtime request failed (HTTP 500)" });
      await expect(repo.listDailyWork({ from: "2026-09-20", to: "2026-11-15" })).resolves.toHaveLength(8);
      await expect(repo.getSyncStatus("solidtime")).resolves.toMatchObject({
        lastFailure: { at: NOW.toISOString(), error: "Solidtime request failed (HTTP 500)" },
      });
    });
  });

  it.each(["listClients", "listProjectsWithRates", "listTimeEntries"] as const)("%s が失敗してもカタログと打刻を保持し、次の同期は実行できる", async (method) => {
    await app.syncSolidtime();
    const catalog = await repo.listProjects({ includeArchived: true });
    f.solidtime[method].mockRejectedValueOnce(new Error("catalog unavailable"));
    await expect(app.syncSolidtime()).resolves.toEqual({ ok: false, error: "catalog unavailable" });
    await expect(repo.listProjects({ includeArchived: true })).resolves.toEqual(catalog);
    await expect(repo.listDailyWork({ from: "2026-09-20", to: "2026-11-15" })).resolves.toHaveLength(8);
    await expect(app.syncSolidtime()).resolves.toMatchObject({ ok: true });
  });

  describe("同期の重なり", () => {
    it("同じ同期が実行中なら、次の同期は実行せず busy を返す", async () => {
      let release: () => void = () => {};
      f.solidtime.listTimeEntries.mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve([]))),
      );
      const first = app.syncSolidtime();
      await vi.waitFor(() => expect(f.solidtime.listTimeEntries).toHaveBeenCalledTimes(1));
      await expect(app.syncSolidtime()).resolves.toEqual({ ok: false, error: "busy" });
      release();
      await expect(first).resolves.toMatchObject({ ok: true });
      expect(f.solidtime.listTimeEntries).toHaveBeenCalledTimes(1);
    });

    it("solidtime と Calendar の同期は同時に動いてよい", async () => {
      let release: () => void = () => {};
      f.solidtime.listTimeEntries.mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve([]))),
      );
      const first = app.syncSolidtime();
      await vi.waitFor(() => expect(f.solidtime.listTimeEntries).toHaveBeenCalledTimes(1));
      await expect(app.syncCalendar()).resolves.toEqual({ ok: true });
      release();
      await first;
    });

    it("busy は失敗として記録しない", async () => {
      let release: () => void = () => {};
      f.solidtime.listTimeEntries.mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve([]))),
      );
      const first = app.syncSolidtime();
      await vi.waitFor(() => expect(f.solidtime.listTimeEntries).toHaveBeenCalledTimes(1));
      await app.syncSolidtime();
      release();
      await first;
      await expect(repo.getSyncStatus("solidtime")).resolves.toMatchObject({ lastFailure: null });
    });
  });

  describe("syncCalendar: Out of Office を取り込む", () => {
    it("今日から予測の最後の月の末日までを、日ごとの不在秒数にして保存する", async () => {
      const result = await app.syncCalendar();
      expect(result).toEqual({ ok: true });
      const [[options]] = f.calendar.listOutOfOffice.mock.calls as unknown as [[{ timeMin: string; timeMax: string }]];
      // 今日 0:00 より前から、2027-02-28 の翌日 0:00 より後まで(境界の予定を取りこぼさないよう広めに取る)
      expect(new Date(options.timeMin).getTime()).toBeLessThanOrEqual(new Date("2026-11-15T00:00:00+09:00").getTime());
      expect(new Date(options.timeMax).getTime()).toBeGreaterThanOrEqual(new Date("2027-03-01T00:00:00+09:00").getTime());
      await expect(repo.listAbsences({ from: "2026-11-15", to: "2027-02-28" })).resolves.toEqual({ "2026-11-16": 2 * HOUR });
    });

    it("失敗したら記録して返す", async () => {
      f.calendar.listOutOfOffice.mockRejectedValueOnce(new Error("Google API request failed (HTTP 403)"));
      await expect(app.syncCalendar()).resolves.toEqual({ ok: false, error: "Google API request failed (HTTP 403)" });
      await expect(repo.getSyncStatus("calendar")).resolves.toMatchObject({ lastFailure: { error: "Google API request failed (HTTP 403)" } });
    });
  });

  describe("dashboard: 今月と来月以降の見込み", () => {
    beforeEach(async () => {
      await app.syncSolidtime();
      await app.syncCalendar();
    });

    it("今月 + forecastMonths か月分の、契約ごとの見込みを出す", async () => {
      const d = await app.dashboard();
      expect(d.asOf).toBe("2026-11-15");
      expect(d.months.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
      expect(d.months.every((m) => m.contracts.length === 1)).toBe(true);
    });

    it("今月の実績は今日までの打刻、予測は明日から(月曜 4h、11/16 は 2h 不在で 2h)", async () => {
      const d = await app.dashboard();
      const nov = d.months[0]!.contracts[0]!;
      // 11 月の実績: 11/02 と 11/09 の 4h ずつ
      expect(nov.actualSeconds).toBe(8 * HOUR);
      // 11 月の予測: 11/16(2h)、11/23(4h)、11/30(4h)
      expect(nov.projects.find((p) => p.projectId === "X")?.forecastSeconds).toBe(10 * HOUR);
      expect(nov.landingSeconds).toBe(18 * HOUR);
      expect(nov.warnings).toEqual([{ kind: "belowMinForecast", seconds: (140 - 18) * HOUR }]);
    });

    it("案件の名前を返す(画面で案件ごとの警告に名前を出すため)", async () => {
      const d = await app.dashboard();
      expect(d.projectNames).toMatchObject({ X: "案件 X" });
    });

    it("案件に結びついていない solidtime の稼働を返す(先月の初めから今日まで。請求に入らないので知らせる)", async () => {
      f.solidtime.listTimeEntries.mockResolvedValueOnce([
        stEntry("a", "X", "2026-11-10", HOUR),
        stEntry("b", "st-unknown", "2026-11-10", 2 * HOUR),
        stEntry("c", "st-unknown", "2026-10-01", HOUR),
      ]);
      await app.syncSolidtime();
      const d = await app.dashboard();
      expect(d.unlinked).toEqual([{ solidtimeProjectId: "st-unknown", seconds: 3 * HOUR }]);
      expect(d.unlinked).toEqual(await repo.listUnlinkedSolidtimeProjects({ from: "2026-10-01", to: "2026-11-15" }));
    });

    it("同期の状態も返す", async () => {
      const d = await app.dashboard();
      expect(d.sync.solidtime.lastSuccessAt).toBe(NOW.toISOString());
      expect(d.sync.calendar.lastSuccessAt).toBe(NOW.toISOString());
    });
  });

  describe("invoiceGuide: 請求書の作成ガイド", () => {
    it("取引先と月を指定すると、保存した契約と取り込んだ打刻から作る", async () => {
      await app.syncSolidtime();
      const guide = await app.invoiceGuide({ clientId: "client-a", month: "2026-11" });
      expect(guide).toMatchObject({
        clientName: "A 社",
        invoiceDate: "2026-11-30",
        dueDate: "2026-12-31",
        lines: [{ item: "案件 X 2026年11月分", quantity: 8, unitPrice: 5_000, amount: 40_000 }],
        total: 44_000,
      });
    });

    it("ない取引先は受け付けない", async () => {
      await expect(app.invoiceGuide({ clientId: "nope", month: "2026-11" })).rejects.toThrow(RangeError);
    });
  });

  describe("Drive: 案件のフォルダと書類", () => {
    it("ensureProjectFolder: ルート/取引先/案件 のフォルダを用意し、ID を保存する", async () => {
      await expect(app.ensureProjectFolder("X")).resolves.toEqual({ folderId: "folder:案件 X" });
      expect(f.drive.ensureFolder).toHaveBeenNthCalledWith(1, { parentId: "root", name: "A 社" });
      expect(f.drive.ensureFolder).toHaveBeenNthCalledWith(2, { parentId: "folder:A 社", name: "案件 X" });
      await expect(repo.getClient("client-a")).resolves.toMatchObject({ driveFolderId: "folder:A 社" });
      await expect(repo.listProjects().then((ps) => ps.find((p) => p.id === "X"))).resolves.toMatchObject({
        driveFolderId: "folder:案件 X",
      });
    });

    it("保存済みの ID があれば Drive に問い合わせない", async () => {
      await app.ensureProjectFolder("X");
      f.drive.ensureFolder.mockClear();
      await app.ensureProjectFolder("X");
      expect(f.drive.ensureFolder).not.toHaveBeenCalled();
    });

    it("uploadDocument: 案件のフォルダにアップロードしてリンクを返す", async () => {
      const result = await app.uploadDocument({
        projectId: "X",
        name: "請求書_2026-11.pdf",
        mimeType: "application/pdf",
        data: new Uint8Array([1, 2, 3]),
      });
      expect(result).toEqual({ fileId: "file:請求書_2026-11.pdf", webViewLink: "https://drive.google.com/請求書_2026-11.pdf" });
      expect(f.drive.uploadFile).toHaveBeenCalledWith(expect.objectContaining({ folderId: "folder:案件 X" }));
    });

    it("ない案件は受け付けない", async () => {
      await expect(app.ensureProjectFolder("nope")).rejects.toThrow(RangeError);
    });
  });
});
