import { createDatabase, createRepository, migrateToLatest, type Database, type Repository } from "@fpm/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/index.ts";

// 案件の今の単価 = 直近の打刻のユーザーで、同期した時点の solidtime の単価で決め直したもの
// (保存してある打刻の単価をそのまま使わない。直近の打刻が同期の範囲の外にあっても同じ)
const HOUR = 3_600;
const NOW = new Date("2026-11-15T03:00:00Z");

const stProject = (id: string, hourlyRate: number | null) => ({
  id, name: `案件 ${id}`, color: "#ef5350", clientId: "st-client-a",
  isArchived: false, isBillable: true, isPublic: false, estimatedTime: null, hourlyRate,
});
const entry = (id: string, userId: string, projectId: string, date: string, hourlyRate: number | null) => ({
  id, userId, projectId, date, seconds: HOUR, billable: true,
  start: `${date}T00:00:00Z`, end: `${date}T01:00:00Z`, description: null, hourlyRate,
});

describe("案件の今の単価", () => {
  let db: Database;
  let repo: Repository;
  let app: ReturnType<typeof createApp>;
  const solidtime = {
    listClients: vi.fn(async () => [{ id: "st-client-a", name: "A 社", isArchived: false }]),
    listProjectsWithRates: vi.fn(async () => [stProject("st-x", 5_000)]),
    listTimeEntriesWithRates: vi.fn(async () => [entry("e1", "user-company", "st-x", "2026-11-02", 6_000)]),
    /** (案件, ユーザー) ごとの、今の solidtime の単価(打刻を取らずに決める) */
    currentRates: vi.fn(async (pairs: readonly { projectId: string; userId: string }[]) => pairs.map(() => 6_000 as number | null)),
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
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("直近の打刻のユーザーで、今の単価を決め直す", async () => {
    await app.syncSolidtime();
    expect(solidtime.currentRates).toHaveBeenLastCalledWith([{ projectId: "st-x", userId: "user-company" }]);
    expect((await repo.listProjects()).find((p) => p.id === "st-x")?.hourlyRate).toBe(6_000);
  });

  it("直近の打刻が同期の範囲の外(保存済み)でも、そのユーザーの今の単価で決め直す", async () => {
    solidtime.listTimeEntriesWithRates.mockResolvedValue([]);
    await app.syncSolidtime();
    // 範囲の外(8 月)に、会社専用のユーザーの打刻が保存されている。保存したときの単価は 5,000 円
    await repo.replaceTimeEntries({ from: "2026-08-01", to: "2026-08-31" }, [
      { id: "old", solidtimeProjectId: "st-x", userId: "user-company", date: "2026-08-03", seconds: HOUR, billable: true, hourlyRate: 5_000, start: "2026-08-03T00:00:00Z" },
    ] as never);
    // solidtime ではそのユーザーの単価が 7,000 円に変わった
    solidtime.currentRates.mockResolvedValueOnce([7_000]);
    await app.syncSolidtime();
    expect(solidtime.currentRates).toHaveBeenLastCalledWith([{ projectId: "st-x", userId: "user-company" }]);
    expect((await repo.listProjects()).find((p) => p.id === "st-x")?.hourlyRate).toBe(7_000);
    solidtime.listTimeEntriesWithRates.mockReset();
    solidtime.listTimeEntriesWithRates.mockResolvedValue([entry("e1", "user-company", "st-x", "2026-11-02", 6_000)]);
  });

  it("打刻のない案件は、案件の単価(案件 → 組織)", async () => {
    solidtime.listTimeEntriesWithRates.mockResolvedValueOnce([]);
    await app.syncSolidtime();
    expect((await repo.listProjects()).find((p) => p.id === "st-x")?.hourlyRate).toBe(5_000);
  });
});
