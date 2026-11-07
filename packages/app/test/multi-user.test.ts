import type { Contract } from "@fpm/domain";
import { createDatabase, createRepository, migrateToLatest, type Database, type Repository } from "@fpm/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/index.ts";

// solidtime のユーザーが複数(会社専用のユーザーなど)でも、全部自分の稼働。打刻ごとの単価で請求する
const HOUR = 3_600;
const NOW = new Date("2026-11-15T03:00:00Z");

const stProject = (id: string, hourlyRate: number | null = 5_000) => ({
  id,
  name: `案件 ${id}`,
  color: "#ef5350",
  clientId: "st-client-a",
  isArchived: false,
  isBillable: true,
  isPublic: false,
  estimatedTime: null,
  hourlyRate,
});
const entry = (id: string, userId: string, projectId: string | null, date: string, seconds: number, hourlyRate: number | null) => ({
  id,
  userId,
  projectId,
  date,
  seconds,
  billable: true,
  start: `${date}T00:00:00Z`,
  end: `${date}T01:00:00Z`,
  description: null,
  hourlyRate,
});

const contract: Contract = {
  id: "c1",
  clientId: "st-client-a",
  name: "業務委託契約",
  start: "2026-01-01",
  end: null,
  projectIds: ["st-x"],
  renewalOutlook: "undecided",
};

describe("複数の solidtime ユーザーの打刻", () => {
  let db: Database;
  let repo: Repository;
  let app: ReturnType<typeof createApp>;
  const solidtime = {
    currentRates: vi.fn(async (pairs: readonly { projectId: string; userId: string }[]): Promise<(number | null)[]> => pairs.map(({ userId }) => userId === "user-company" ? 6000 : 5000)),
    listClients: vi.fn(async () => [{ id: "st-client-a", name: "A 社", isArchived: false }]),
    listProjectsWithRates: vi.fn(async () => [stProject("st-x")]),
    listTimeEntriesWithRates: vi.fn(async () => [
      entry("e1", "user-me", "st-x", "2026-11-02", 10 * HOUR, 5_000),
      entry("e2", "user-company", "st-x", "2026-11-10", 2 * HOUR, 6_000),
    ]),
  };

  beforeEach(async () => {
    db = await createDatabase({ kind: "sqlite", filename: ":memory:" });
    await migrateToLatest(db);
    repo = createRepository(db);
    app = createApp({
      repo,
      solidtime,
      calendar: { listOutOfOffice: vi.fn(async () => []) },
      drive: { ensureFolder: vi.fn(), uploadFile: vi.fn(), listFiles: vi.fn(async () => []) },
      clock: { now: () => NOW },
      config: { timeZone: "Asia/Tokyo", forecastWeeks: 8, forecastMonths: 3, driveRootFolderId: "root" },
    } as never);
    await app.syncSolidtime();
    await repo.saveContract(contract);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("どのユーザーの打刻も実績に入る", async () => {
    const nov = (await app.dashboard()).months[0]!.contracts[0]!;
    expect(nov.actualSeconds).toBe(12 * HOUR);
  });

  it("同じ案件で単価の違う打刻は、単価ごとの明細にする", async () => {
    const guide = await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" });
    expect(guide?.lines.map((l) => [l.quantity, l.unitPrice, l.amount])).toEqual([
      [10, 5_000, 50_000],
      [2, 6_000, 12_000],
    ]);
    expect(guide?.subtotal).toBe(62_000);
  });

  it("単価のない打刻だけを、単価が未設定として知らせる", async () => {
    solidtime.listTimeEntriesWithRates.mockResolvedValueOnce([
      entry("e1", "user-me", "st-x", "2026-11-02", 10 * HOUR, 5_000),
      entry("e3", "user-company", "st-x", "2026-11-10", 3 * HOUR, null),
    ]);
    await app.syncSolidtime();
    const guide = await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" });
    expect(guide?.lines.map((l) => [l.quantity, l.unitPrice])).toEqual([[10, 5_000]]);
    expect(guide?.warnings).toEqual([{ kind: "missingRate", projectId: "st-x", projectName: "案件 st-x", seconds: 3 * HOUR }]);
  });

  it("案件の今の単価は、直近の打刻のユーザーの今の単価(一覧と予測の見込み額に使う)", async () => {
    const x = (await repo.listProjects()).find((p) => p.id === "st-x");
    expect(x?.hourlyRate).toBe(6_000);
  });

  it("打刻がない案件の今の単価は、案件の単価(solidtime の案件 → 組織)", async () => {
    solidtime.listProjectsWithRates.mockResolvedValueOnce([stProject("st-x"), stProject("st-new", 7_000)]);
    await app.syncSolidtime();
    expect((await repo.listProjects()).find((p) => p.id === "st-new")?.hourlyRate).toBe(7_000);
  });

  it.each([null, 0, 7000.25])("同期範囲外のユーザーの現在単価 %s を使い、保存済みの請求単価は変えない", async (hourlyRate) => {
    const august = { from: "2026-08-01", to: "2026-08-31" };
    await repo.replaceTimeEntries(august, [
      { ...entry("old", "user-company", "st-x", "2026-08-01", HOUR, 5000), solidtimeProjectId: "st-x" },
      { ...entry("nonbillable", "user-me", "st-x", "2026-08-02", HOUR, 9000), solidtimeProjectId: "st-x", billable: false },
    ]);
    solidtime.listTimeEntriesWithRates.mockResolvedValueOnce([]);
    solidtime.currentRates.mockResolvedValueOnce([hourlyRate]);
    await expect(app.syncSolidtime()).resolves.toMatchObject({ ok: true });
    expect(solidtime.currentRates).toHaveBeenLastCalledWith([{ projectId: "st-x", userId: "user-company" }]);
    expect((await repo.listProjects())[0]?.hourlyRate).toBe(hourlyRate);
    expect(await repo.listDailyWork(august)).toEqual([{ projectId: "st-x", date: "2026-08-01", seconds: HOUR, hourlyRate: 5000 }]);
    expect((await app.invoiceGuide({ clientId: "st-client-a", month: "2026-08" }))?.subtotal).toBe(5000);
  });

  it("移行前の打刻にユーザーが残っていないときは、案件 → 組織の単価を使う", async () => {
    await repo.replaceTimeEntries({ from: "2026-08-01", to: "2026-08-31" }, [
      { id: "legacy", solidtimeProjectId: "st-x", date: "2026-08-01", start: "2026-08-01T00:00:00Z", seconds: HOUR, hourlyRate: 7000, billable: true },
    ]);
    solidtime.listTimeEntriesWithRates.mockResolvedValueOnce([]);
    await expect(app.syncSolidtime()).resolves.toMatchObject({ ok: true });
    expect(solidtime.currentRates).toHaveBeenLastCalledWith([]);
    expect((await repo.listProjects())[0]?.hourlyRate).toBe(5000);
  });
});
