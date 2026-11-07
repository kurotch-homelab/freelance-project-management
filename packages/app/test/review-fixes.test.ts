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

describe("レビューを受けて: 取引先の変更・契約のない稼働・警告・見込み額", () => {
  let db: Database;
  let repo: Repository;
  let f: ReturnType<typeof fakes>;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = await createDatabase({ kind: "sqlite", filename: ":memory:" });
    await migrateToLatest(db);
    repo = createRepository(db);
    f = fakes();
    f.solidtime.listClients.mockResolvedValue([stClient("st-client-a", "A 社"), stClient("st-client-b", "B 社")]);
    app = createApp({
      repo,
      solidtime: f.solidtime,
      calendar: f.calendar,
      drive: f.drive,
      clock: { now: () => NOW },
      config: { timeZone: "Asia/Tokyo", forecastWeeks: 8, forecastMonths: 3, driveRootFolderId: "root" },
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  const moveXToB = () =>
    f.solidtime.listProjectsWithRates.mockResolvedValue([stProject("st-x", { clientId: "st-client-b" }), stProject("st-old", { isArchived: true })]);

  it("solidtime で案件の取引先が変わっても、ダッシュボードは出て、食い違いを知らせる", async () => {
    await app.syncSolidtime();
    await repo.saveContract(contract);
    moveXToB();
    await app.syncSolidtime();
    const d = await app.dashboard();
    expect(d.contractProjectMismatches).toEqual([
      { contractId: "c1", contractName: "業務委託契約", projectId: "st-x", projectName: "案件 st-x", projectClientId: "st-client-b" },
    ]);
  });

  it("取引先が変わった案件が入ったままの古い契約も、終了日を変えて保存できる。新しく入れることはできない", async () => {
    await app.syncSolidtime();
    await repo.saveContract(contract);
    moveXToB();
    await app.syncSolidtime();
    await expect(repo.saveContract({ ...contract, end: "2026-11-30" })).resolves.not.toThrow();
    await expect(
      repo.saveContract({ ...contract, id: "c9", start: "2027-01-01", end: null, projectIds: ["st-x"] }),
    ).rejects.toThrow();
  });

  it("移った先の取引先の請求書ガイドに、その案件の稼働が出る(案件ごとのまとめ方は契約がなくてよい)", async () => {
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue([stEntry("a", "st-x", "2026-11-10", 10 * HOUR)]);
    await app.syncSolidtime();
    await repo.saveContract(contract);
    moveXToB();
    await app.syncSolidtime();
    const guide = await app.invoiceGuide({ clientId: "st-client-b", month: "2026-11" });
    expect(guide?.lines).toEqual([{ item: "案件 st-x 2026年11月分", quantity: 10, unit: "時間", unitPrice: 5_000, amount: 50_000 }]);
  });

  it("契約のない案件の稼働も、案件ごとのまとめ方なら請求書ガイドに出し、ダッシュボードで知らせる", async () => {
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue([stEntry("a", "st-x", "2026-11-10", 10 * HOUR)]);
    await app.syncSolidtime();
    const guide = await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" });
    expect(guide?.lines).toEqual([{ item: "案件 st-x 2026年11月分", quantity: 10, unit: "時間", unitPrice: 5_000, amount: 50_000 }]);
    const d = await app.dashboard();
    expect(d.workWithoutContract).toEqual([{ projectId: "st-x", name: "案件 st-x", seconds: 10 * HOUR }]);
  });

  it("契約ごとのまとめ方で契約のない稼働は、案件名の行で出して警告する", async () => {
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue([stEntry("a", "st-x", "2026-11-10", 10 * HOUR)]);
    await app.syncSolidtime();
    await app.updateClientBilling("st-client-a", {
      paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
      subjectTemplate: "{YYYY}年{M}月分 業務委託料",
      lineGrouping: "contract",
    });
    const guide = await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" });
    expect(guide?.lines.map((l) => [l.item, l.amount])).toEqual([["案件 st-x 2026年11月分", 50_000]]);
    expect(guide?.warnings).toContainEqual({ kind: "missingContract", projectId: "st-x", projectName: "案件 st-x", seconds: 10 * HOUR });
  });

  it("アーカイブした案件でも、先月の初めから今日までに稼働があれば、単価・取引先がないことを知らせる", async () => {
    f.solidtime.listProjectsWithRates.mockResolvedValue([
      stProject("st-x"),
      stProject("st-old-norate", { isArchived: true, hourlyRate: null }),
      stProject("st-old-free", { isArchived: true, clientId: null }),
      stProject("st-old-idle", { isArchived: true, hourlyRate: null }),
    ]);
    f.solidtime.listTimeEntriesWithRates.mockResolvedValue([
      stEntry("a", "st-old-norate", "2026-11-10", HOUR, null),
      stEntry("b", "st-old-free", "2026-10-20", HOUR),
      stEntry("c", "st-old-idle", "2026-09-10", HOUR),
    ]);
    await app.syncSolidtime();
    const d = await app.dashboard();
    expect(d.projectsWithoutRate).toEqual([{ id: "st-old-norate", name: "案件 st-old-norate" }]);
    expect(d.projectsWithoutClient).toEqual([{ id: "st-old-free", name: "案件 st-old-free" }]);
  });

  it.each([
    [{ closingDay: 31, paymentMonthOffset: 0, paymentDay: 1 }, "{YYYY}年{M}月分"],
    [{ closingDay: "end" as const, paymentMonthOffset: 1, paymentDay: "end" as const }, "   "],
  ])("あとで請求書ガイドが出せなくなる請求の設定は保存しない(%o, %j)", async (paymentTerms, subjectTemplate) => {
    await app.syncSolidtime();
    await expect(app.updateClientBilling("st-client-a", { paymentTerms, subjectTemplate, lineGrouping: "project" })).rejects.toThrow(RangeError);
    await expect(repo.getClient("st-client-a")).resolves.toMatchObject({
      paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
      subjectTemplate: "{YYYY}年{M}月分 業務委託料",
    });
  });

  it("月の請求見込み(税込)は取引先ごとに出し、請求書ガイドと同じ決まり(案件ごとに時間を切り捨て、税は 1 回)で計算する", async () => {
    await app.syncSolidtime();
    await repo.saveContract({ ...contract, end: "2026-11-15", renewalOutlook: "likely" });
    await repo.saveContract({ ...contract, id: "c2", start: "2026-11-16" });
    const nov = (await app.dashboard()).months[0]!;
    const xLanding = nov.contracts
      .flatMap((c) => c.projects)
      .filter((p) => p.projectId === "st-x")
      .reduce((sum, p) => sum + p.landingSeconds, 0);
    const subtotal = Math.floor((Math.floor(xLanding / 36) * 5_000) / 100);
    const oldLanding = nov.contracts
      .flatMap((c) => c.projects)
      .filter((p) => p.projectId === "st-old")
      .reduce((sum, p) => sum + p.landingSeconds, 0);
    const oldSubtotal = Math.floor((Math.floor(oldLanding / 36) * 6_000) / 100);
    const tax = Math.floor((subtotal + oldSubtotal) / 10);
    expect(nov.clients).toEqual([
      {
        clientId: "st-client-a",
        clientName: "A 社",
        estimate: { subtotal: subtotal + oldSubtotal, tax, total: subtotal + oldSubtotal + tax },
      },
    ]);
  });
});
