import type { Contract } from "@fpm/domain";
import { createDatabase, createRepository, migrateToLatest, type Database, type Repository } from "@fpm/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type AppDeps } from "../src/index.ts";

// solidtime を取引先・案件・単価の正とし、読み取りだけで取り込む(docs/requirements.md 4 章)
const HOUR = 3_600;
const NOW = new Date("2026-11-15T03:00:00Z"); // 2026-11-15(日)12:00 JST

const stClient = (id: string, name: string, isArchived = false) => ({ id, name, isArchived });
const stProject = (
  id: string,
  over: Partial<{ name: string; clientId: string | null; isArchived: boolean; hourlyRate: number | null }> = {},
) => ({
  id,
  name: `案件 ${id}`,
  color: "#ef5350",
  clientId: "st-client-a",
  isArchived: false,
  isBillable: true,
  isPublic: false,
  estimatedTime: null,
  hourlyRate: 5_000,
  ...over,
});
const stEntry = (id: string, projectId: string | null, date: string, seconds: number, hourlyRate: number | null = 5000) => ({
  id,
  projectId,
  date,
  seconds,
  billable: true,
  start: `${date}T00:00:00Z`,
  end: `${date}T01:00:00Z`,
  description: null,
  userId: "user-me",
  hourlyRate,
});

/** 直近 8 週の月曜 */
const mondays = ["2026-11-09", "2026-11-02", "2026-10-26", "2026-10-19", "2026-10-12", "2026-10-05", "2026-09-28", "2026-09-21"];

const contract: Contract = {
  id: "c1",
  clientId: "st-client-a",
  name: "業務委託契約",
  start: "2026-01-01",
  end: null,
  projectIds: ["st-x", "st-old"],
  renewalOutlook: "undecided",
};

const fakes = () => ({
  solidtime: {
    listClients: vi.fn(async () => [stClient("st-client-a", "A 社")]),
    listProjectsWithRates: vi.fn(async () => [
      stProject("st-x"),
      stProject("st-old", { isArchived: true, hourlyRate: 6_000 }),
      stProject("st-free", { clientId: null }),
      stProject("st-norate", { hourlyRate: null }),
    ]),
    listTimeEntriesWithRates: vi.fn(async () => [
      ...mondays.map((d, i) => stEntry(`x${i}`, "st-x", d, 4 * HOUR)),
      ...mondays.map((d, i) => stEntry(`o${i}`, "st-old", d, 2 * HOUR, 6000)),
    ]),
  },
  calendar: { listOutOfOffice: vi.fn(async () => []) },
  drive: {
    ensureFolder: vi.fn(async ({ name }: { parentId: string; name: string }) => ({ id: `folder:${name}`, name })),
    uploadFile: vi.fn(async ({ name }: { name: string }) => ({ id: `file:${name}`, name, webViewLink: `https://drive.google.com/${name}` })),
    listFiles: vi.fn(async () => []),
  },
});

describe("solidtime を正として取り込む", () => {
  let db: Database;
  let repo: Repository;
  let f: ReturnType<typeof fakes>;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = await createDatabase({ kind: "sqlite", filename: ":memory:" });
    await migrateToLatest(db);
    repo = createRepository(db);
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

  it("取引先を取り込む。初めての取引先は請求の設定を初期値で作る", async () => {
    await expect(app.syncSolidtime()).resolves.toMatchObject({ ok: true });
    await expect(repo.listClients()).resolves.toEqual([
      {
        id: "st-client-a",
        name: "A 社",
        archived: false,
        paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
        subjectTemplate: "{YYYY}年{M}月分 業務委託料",
        lineGrouping: "project",
        driveFolderId: null,
      },
    ]);
  });

  it("請求の設定はこのシステムで変えられ、次の同期でも残る(名前は solidtime に合わせる)", async () => {
    await app.syncSolidtime();
    await app.updateClientBilling("st-client-a", {
      paymentTerms: { closingDay: 20, paymentMonthOffset: 2, paymentDay: 10 },
      subjectTemplate: "{M}月分",
      lineGrouping: "contract",
    });
    f.solidtime.listClients.mockResolvedValue([stClient("st-client-a", "A 株式会社")]);
    await app.syncSolidtime();
    await expect(repo.getClient("st-client-a")).resolves.toMatchObject({
      name: "A 株式会社",
      paymentTerms: { closingDay: 20, paymentMonthOffset: 2, paymentDay: 10 },
      subjectTemplate: "{M}月分",
      lineGrouping: "contract",
    });
  });

  it("ない取引先の請求の設定は変えられない", async () => {
    await expect(
      app.updateClientBilling("nope", {
        paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
        subjectTemplate: "x",
        lineGrouping: "project",
      }),
    ).rejects.toThrow(RangeError);
  });

  it("案件を、取引先・アーカイブ・今の単価つきで取り込む", async () => {
    await app.syncSolidtime();
    const projects = await repo.listProjects({ includeArchived: true });
    expect(projects.find((p) => p.id === "st-x")).toEqual({
      id: "st-x",
      clientId: "st-client-a",
      name: "案件 st-x",
      archived: false,
      hourlyRate: 5_000,
      driveFolderId: null,
    });
    expect(projects.find((p) => p.id === "st-old")).toMatchObject({ archived: true, hourlyRate: 6_000 });
    expect(projects.find((p) => p.id === "st-free")).toMatchObject({ clientId: null });
    expect(projects.find((p) => p.id === "st-norate")).toMatchObject({ hourlyRate: null });
  });

  it("Drive のフォルダーはこのシステムのものなので、同期しても残る", async () => {
    await app.syncSolidtime();
    const { folderId } = await app.ensureProjectFolder("st-x");
    await app.syncSolidtime();
    expect((await repo.listProjects()).find((p) => p.id === "st-x")?.driveFolderId).toBe(folderId);
  });

  it("solidtime から消えた取引先・案件は消さず、アーカイブとして残す", async () => {
    await app.syncSolidtime();
    f.solidtime.listClients.mockResolvedValue([]);
    f.solidtime.listProjectsWithRates.mockResolvedValue([]);
    await app.syncSolidtime();
    await expect(repo.getClient("st-client-a")).resolves.toMatchObject({ archived: true });
    expect((await repo.listProjects({ includeArchived: true })).find((p) => p.id === "st-x")).toMatchObject({ archived: true });
  });

  it("solidtime に書き込まない(単価の反映はしない)", () => {
    expect((app as Record<string, unknown>).pushRates).toBeUndefined();
  });

  it("請求書ガイドの単価は、取り込んだ打刻の単価", async () => {
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue([stEntry("a", "st-x", "2026-11-10", 10 * HOUR)]);
    await app.syncSolidtime();
    await repo.saveContract(contract);
    const guide = await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" });
    expect(guide?.lines).toEqual([{ item: "案件 st-x 2026年11月分", quantity: 10, unit: "時間", unitPrice: 5_000, amount: 50_000 }]);
    expect(guide?.warnings).toEqual([]);
  });

  it("単価が未設定の案件は明細に入れず、警告で知らせる", async () => {
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue([
      stEntry("a", "st-x", "2026-11-10", 10 * HOUR),
      stEntry("b", "st-norate", "2026-11-10", 3 * HOUR, null),
    ]);
    await app.syncSolidtime();
    await repo.saveContract({ ...contract, projectIds: ["st-x", "st-norate"] });
    const guide = await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" });
    expect(guide?.lines.map((l) => l.item)).toEqual(["案件 st-x 2026年11月分"]);
    expect(guide?.warnings).toEqual([{ kind: "missingRate", projectId: "st-norate", projectName: "案件 st-norate", seconds: 3 * HOUR }]);
    expect(guide?.subtotal).toBe(50_000);
  });

  it("アーカイブした案件も、稼働があれば請求書ガイドに出す", async () => {
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue([stEntry("a", "st-old", "2026-11-10", 2 * HOUR, 6000)]);
    await app.syncSolidtime();
    await repo.saveContract(contract);
    const guide = await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" });
    expect(guide?.lines).toEqual([{ item: "案件 st-old 2026年11月分", quantity: 2, unit: "時間", unitPrice: 6_000, amount: 12_000 }]);
  });

  it("アーカイブした案件は予測しない。実績は数える", async () => {
    await app.syncSolidtime();
    await repo.saveContract(contract);
    const nov = (await app.dashboard()).months[0]!.contracts[0]!;
    const old = nov.projects.find((p) => p.projectId === "st-old")!;
    expect(old.actualSeconds).toBe(2 * 2 * HOUR); // 11/02 と 11/09
    expect(old.forecastSeconds).toBe(0);
    expect(nov.projects.find((p) => p.projectId === "st-x")!.forecastSeconds).toBeGreaterThan(0);
  });

  it("ダッシュボードで、取引先のない案件(請求書ガイドに出せない)を知らせる。アーカイブしたものは除く", async () => {
    f.solidtime.listProjectsWithRates.mockResolvedValue([
      stProject("st-x"),
      stProject("st-free", { clientId: null }),
      stProject("st-free-old", { clientId: null, isArchived: true }),
    ]);
    await app.syncSolidtime();
    const d = await app.dashboard();
    expect(d.projectsWithoutClient).toEqual([{ id: "st-free", name: "案件 st-free" }]);
  });

  it("ダッシュボードで、単価が未設定の案件を知らせる(アーカイブしたものは除く)", async () => {
    await app.syncSolidtime();
    const d = await app.dashboard();
    expect(d.projectsWithoutRate).toEqual([{ id: "st-norate", name: "案件 st-norate" }]);
  });
  it("取引先変更のあった案件とその上書きだけを除外し、残りの案件を予測・請求する", async () => {
    f.solidtime.listProjectsWithRates.mockResolvedValue([stProject("st-x"), stProject("st-old")]);
    await app.syncSolidtime();
    await repo.saveContract({ ...contract, projectHoursRanges: { "st-x": { minHours: 10 } } });
    await repo.saveHoursRangeOverride({ contractId: "c1", projectId: "st-x", month: "2026-11", range: { minHours: 20 }, note: "合意" });
    f.solidtime.listClients.mockResolvedValue([stClient("st-client-a", "A 社"), stClient("st-client-b", "B 社")]);
    f.solidtime.listProjectsWithRates.mockResolvedValue([stProject("st-x", { clientId: "st-client-b" }), stProject("st-old")]);
    await app.syncSolidtime();
    const d = await app.dashboard();
    expect(d.months[0]!.contracts[0]!.projects.map((p) => p.projectId)).toEqual(["st-old"]);
    expect(d.months[0]!.contracts[0]!.forecastSeconds).toBeGreaterThan(0);
    expect(d.workWithoutContract).toEqual([{ projectId: "st-x", name: "案件 st-x", seconds: 8 * HOUR }]);
    expect((await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" }))?.lines.map((line) => line.item)).toEqual(["案件 st-old 2026年11月分"]);
    // 全案件が食い違う契約と、そこに残る上書きも計算を止めない。
    f.solidtime.listProjectsWithRates.mockResolvedValue([stProject("st-x", { clientId: null }), stProject("st-old", { clientId: "st-client-b" })]);
    await app.syncSolidtime();
    expect((await app.dashboard()).months[0]!.contracts).toEqual([]);
    expect(await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" })).toBeNull();
  });

  it.each(["project", "contract"] as const)("%s 単位の見込みとガイドは同じ端数処理で一致する(更新・複数単価・複数取引先・契約なし)", async (lineGrouping) => {
    f.solidtime.listClients.mockResolvedValue([stClient("st-client-a", "A 社"), stClient("st-client-b", "B 社")]);
    f.solidtime.listProjectsWithRates.mockResolvedValue([
      stProject("st-x", { hourlyRate: 4850.25 }), stProject("st-y", { hourlyRate: 4850.25 }),
      stProject("st-old", { hourlyRate: 5000.25, isArchived: true }), stProject("st-norate", { hourlyRate: null }),
      stProject("st-b", { clientId: "st-client-b", hourlyRate: 100.25 }),
    ]);
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue([
      stEntry("x1", "st-x", "2026-11-01", 20, 4850.25), stEntry("x2", "st-x", "2026-11-10", 20, 4850.25),
      stEntry("x3", "st-x", "2026-11-15", 36040, 4850.25), stEntry("y", "st-y", "2026-11-10", 36060, 4850.25),
      stEntry("old", "st-old", "2026-11-10", 37, 5000.25), stEntry("nr", "st-norate", "2026-11-10", 3 * HOUR, null),
      stEntry("b", "st-b", "2026-11-10", 36060, 100.25),
    ]);
    await app.syncSolidtime();
    await repo.saveContract({ ...contract, end: "2026-11-05", projectIds: ["st-x", "st-y"] });
    await repo.saveContract({ ...contract, id: "c2", start: "2026-11-06", end: "2026-11-15", projectIds: ["st-x", "st-y", "st-old", "st-norate"] });
    for (const id of ["st-client-a", "st-client-b"]) {
      await app.updateClientBilling(id, { paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" }, subjectTemplate: "{M}月分", lineGrouping });
    }
    const month = (await app.dashboard()).months[0]!;
    expect(month.contracts.every((c) => c.forecastSeconds === 0)).toBe(true);
    // A: 案件ごとは 48,599 + 48,551 + 50。契約ごとは 0 + 97,150 + 50。
    expect(month.clients).toEqual([
      { clientId: "st-client-a", clientName: "A 社", estimate: { subtotal: 97200, tax: 9720, total: 106920 } },
      { clientId: "st-client-b", clientName: "B 社", estimate: { subtotal: 1003, tax: 100, total: 1103 } },
    ]);
    for (const client of month.clients) {
      const guide = await app.invoiceGuide({ clientId: client.clientId, month: month.month });
      expect(guide).toMatchObject(client.estimate);
    }
    expect(month.contracts.map((c) => c.estimate)).toEqual([{ subtotal: 0 }, { subtotal: lineGrouping === "project" ? 97152 : 97200 }]);
  });

  it("予測期間が短くても先月初日まで同期し、アーカイブ案件の警告は今日までの実績に限る", async () => {
    app = createApp({ repo, ...f, clock: { now: () => NOW }, config: { timeZone: "Asia/Tokyo", forecastWeeks: 1, forecastMonths: 1, driveRootFolderId: "root" } });
    f.solidtime.listProjectsWithRates.mockResolvedValue([
      stProject("recent", { isArchived: true, hourlyRate: null, clientId: null }),
      stProject("idle", { isArchived: true, hourlyRate: null, clientId: null }),
    ]);
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue([
      stEntry("recent", "recent", "2026-10-01", HOUR, null),
      stEntry("old", "idle", "2026-09-30", HOUR), stEntry("future", "idle", "2026-11-16", HOUR),
    ]);
    await expect(app.syncSolidtime()).resolves.toMatchObject({ ok: true });
    expect(f.solidtime.listTimeEntriesWithRates).toHaveBeenCalledWith({ from: "2026-10-01", to: "2026-11-15" });
    const d = await app.dashboard();
    expect(d.projectsWithoutRate).toEqual([{ id: "recent", name: "案件 recent" }]);
    expect(d.projectsWithoutClient).toEqual(d.projectsWithoutRate);
    expect(d.workWithoutContract).toEqual([]);
  });

  it.each(["project", "contract"] as const)("%s 単位で更新前提の着地時間を実績にしたガイドと見込みが一致する", async (lineGrouping) => {
    await app.syncSolidtime();
    await repo.saveContract({ ...contract, end: "2026-11-15", renewalOutlook: "likely" });
    await app.updateClientBilling("st-client-a", { paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" }, subjectTemplate: "{M}月分", lineGrouping });
    const month = (await app.dashboard()).months[0]!;
    expect(month.contracts[0]!.forecastSeconds).toBeGreaterThan(0);
    expect(month.contracts[0]!.assumesRenewal).toBe(true);
    await repo.saveContract({ ...contract, end: "2026-11-30" });
    await repo.replaceTimeEntries({ from: "2026-11-01", to: "2026-11-30" }, month.contracts[0]!.projects.map((project) => ({
      id: project.projectId, solidtimeProjectId: project.projectId, date: "2026-11-30", seconds: project.landingSeconds, billable: true, hourlyRate: project.projectId === "st-old" ? 6000 : 5000,
    })));
    expect(await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" })).toMatchObject(month.clients[0]!.estimate);
  });

  it("契約なし稼働は日ごとに実契約で判定し、アーカイブ案件も含める", async () => {
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue([
      stEntry("before", "st-old", "2026-11-09", HOUR), stEntry("start", "st-old", "2026-11-10", 2 * HOUR),
      stEntry("end", "st-old", "2026-11-12", 3 * HOUR), stEntry("after", "st-old", "2026-11-13", 4 * HOUR),
      { ...stEntry("nonbillable", "st-old", "2026-11-14", 7 * HOUR), billable: false },
    ]);
    await app.syncSolidtime();
    await repo.saveContract({ ...contract, start: "2026-11-10", end: "2026-11-12", projectIds: ["st-old"], renewalOutlook: "likely" });
    await app.updateClientBilling("st-client-a", { paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" }, subjectTemplate: "{M}月分", lineGrouping: "contract" });
    expect((await app.dashboard()).workWithoutContract).toEqual([{ projectId: "st-old", name: "案件 st-old", seconds: 5 * HOUR }]);
    const guide = await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" });
    expect(guide?.lines.map((line) => [line.item, line.quantity])).toEqual([
      ["案件 st-old 2026年11月分", 5], ["業務委託契約 2026年11月分", 5],
    ]);
    expect(guide?.warnings).toEqual([{ kind: "missingContract", projectId: "st-old", projectName: "案件 st-old", seconds: 5 * HOUR }]);
  });

  it.each(["project", "contract"] as const)("%s 単位で同じ案件の複数単価を分け、単価なしの実績だけを警告する", async (lineGrouping) => {
    f.solidtime.listProjectsWithRates.mockResolvedValue([stProject("st-x", { hourlyRate: 9999 })]);
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue([
      stEntry("missing", "st-x", "2026-11-01", HOUR, null),
      stEntry("a1", "st-x", "2026-11-10", 20, 4850.25),
      { ...stEntry("a2", "st-x", "2026-11-10", 20, 4850.25), userId: "user-company" },
      stEntry("b", "st-x", "2026-11-10", 20, 6000.25),
      stEntry("zero", "st-x", "2026-11-11", HOUR, 0),
      stEntry("latest", "st-x", "2026-11-15", 36, 6000.25),
    ]);
    await expect(app.syncSolidtime()).resolves.toMatchObject({ ok: true });
    await repo.saveContract({ ...contract, end: "2026-11-15", projectIds: ["st-x"] });
    await app.updateClientBilling("st-client-a", {
      paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" }, subjectTemplate: "{M}月分", lineGrouping,
    });
    const guide = await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" });
    expect(guide?.lines.map((line) => [line.quantity, line.unitPrice, line.amount])).toEqual([
      [0.01, 4850.25, 48], [0.01, 6000.25, 60], [1, 0, 0],
    ]);
    expect(guide?.warnings).toEqual([{ kind: "missingRate", projectId: "st-x", projectName: "案件 st-x", seconds: HOUR }]);
    expect((await repo.listProjects())[0]?.hourlyRate).toBe(6000.25);
    const dashboard = await app.dashboard();
    expect(dashboard.projectsWithoutRate).toEqual([{ id: "st-x", name: "案件 st-x" }]);
    expect(dashboard.months[0]!.contracts[0]!).toMatchObject({ actualSeconds: 7296, forecastSeconds: 0, estimate: { subtotal: 108 } });
    expect(dashboard.months[0]!.clients[0]!.estimate).toEqual({ subtotal: 108, tax: 10, total: 118 });
    expect(guide).toMatchObject(dashboard.months[0]!.clients[0]!.estimate);
  });

  it.each(["project", "contract"] as const)("%s 単位で実績は打刻の単価、予測は直近の打刻の単価で計算する", async (lineGrouping) => {
    f.solidtime.listProjectsWithRates.mockResolvedValue([stProject("st-x", { hourlyRate: 9999 })]);
    const entries = mondays.flatMap((date, i) => [
      stEntry(`me${i}`, "st-x", date, HOUR, 5000),
      { ...stEntry(`company${i}`, "st-x", date, HOUR, 6000), userId: "company", start: `${date}T02:00:00Z`, end: `${date}T03:00:00Z` },
    ]);
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue(entries);
    await app.syncSolidtime();
    await repo.saveContract({ ...contract, projectIds: ["st-x"] });
    await app.updateClientBilling("st-client-a", {
      paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" }, subjectTemplate: "{M}月分", lineGrouping,
    });
    const month = (await app.dashboard()).months[0]!;
    expect(month.contracts[0]).toMatchObject({ actualSeconds: 4 * HOUR, forecastSeconds: 6 * HOUR, estimate: { subtotal: 58000 } });
    expect(month.clients[0]!.estimate).toEqual({ subtotal: 58000, tax: 5800, total: 63800 });
    expect(await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" })).toMatchObject({ subtotal: 22000 });
    // Turn the forecast into actual work and compare the resulting invoice.
    await repo.replaceTimeEntries({ from: "2026-11-16", to: "2026-11-30" }, [
      { id: "forecast", solidtimeProjectId: "st-x", date: "2026-11-30", seconds: 6 * HOUR, hourlyRate: 6000, billable: true },
    ]);
    expect(await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" })).toMatchObject(month.clients[0]!.estimate);
  });

});
