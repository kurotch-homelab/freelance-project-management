import type { Contract } from "@fpm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDatabase,
  createRepository,
  migrateToLatest,
  type ClientRecord,
  type Database,
  type ProjectRecord,
  type Repository,
} from "../src/index.ts";

// 同じテストを SQLite(node:sqlite)と PostgreSQL(PGlite)の両方で流す
const backends = [
  ["sqlite", () => createDatabase({ kind: "sqlite", filename: ":memory:" })],
  ["postgres (PGlite)", () => createDatabase({ kind: "pglite" })],
] as const;

const clientA: ClientRecord = {
  id: "client-a",
  name: "A 社",
  paymentTerms: { closingDay: "end", paymentMonthOffset: 1, paymentDay: "end" },
  subjectTemplate: "{YYYY}年{M}月分 業務委託料",
  lineGrouping: "project",
  solidtimeClientId: "st-client-a",
  driveFolderId: null,
};

const projectX: ProjectRecord = {
  id: "X",
  clientId: "client-a",
  name: "案件 X",
  status: "active",
  solidtimeProjectId: "st-x",
  driveFolderId: null,
};
const projectY: ProjectRecord = { ...projectX, id: "Y", name: "案件 Y", solidtimeProjectId: "st-y" };

const contract1: Contract = {
  id: "c1",
  clientId: "client-a",
  name: "業務委託契約",
  start: "2026-10-01",
  end: "2026-12-31",
  hourlyRate: 5_000,
  projectIds: ["X", "Y"],
  projectRates: { Y: 7_000 },
  hoursRange: { minHours: 140, maxHours: 180 },
  projectHoursRanges: { Y: { maxHours: 30.5 } },
  renewalOutlook: "likely",
};

describe.each(backends)("Repository (%s)", (_name, open) => {
  let db: Database;
  let repo: Repository;

  beforeEach(async () => {
    db = await open();
    await migrateToLatest(db);
    repo = createRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("マイグレーション", () => {
    it("2 回流しても失敗しない", async () => {
      await expect(migrateToLatest(db)).resolves.not.toThrow();
    });
  });

  describe("取引先", () => {
    it("保存して読み戻す(支払条件・明細行の分け方も)", async () => {
      await repo.saveClient(clientA);
      await expect(repo.getClient("client-a")).resolves.toEqual(clientA);
    });

    it("同じ id で保存すると上書きする", async () => {
      await repo.saveClient(clientA);
      await repo.saveClient({ ...clientA, name: "A 株式会社", paymentTerms: { closingDay: 20, paymentMonthOffset: 2, paymentDay: 10 } });
      await expect(repo.getClient("client-a")).resolves.toMatchObject({
        name: "A 株式会社",
        paymentTerms: { closingDay: 20, paymentMonthOffset: 2, paymentDay: 10 },
      });
    });

    it("一覧は名前の順", async () => {
      await repo.saveClient({ ...clientA, id: "b", name: "B 社" });
      await repo.saveClient(clientA);
      await expect(repo.listClients().then((cs) => cs.map((c) => c.name))).resolves.toEqual(["A 社", "B 社"]);
    });

    it("ないときは null", async () => {
      await expect(repo.getClient("nope")).resolves.toBeNull();
    });
  });

  describe("案件", () => {
    beforeEach(async () => {
      await repo.saveClient(clientA);
    });

    it("保存して読み戻す。取引先で絞り込める", async () => {
      await repo.saveProject(projectX);
      await repo.saveProject(projectY);
      await expect(repo.listProjects()).resolves.toEqual([projectX, projectY]);
      await expect(repo.listProjects({ clientId: "client-a" })).resolves.toHaveLength(2);
      await expect(repo.listProjects({ clientId: "other" })).resolves.toEqual([]);
    });

    it("solidtime のプロジェクト ID から引ける", async () => {
      await repo.saveProject(projectX);
      await expect(repo.findProjectBySolidtimeId("st-x")).resolves.toEqual(projectX);
      await expect(repo.findProjectBySolidtimeId("nope")).resolves.toBeNull();
    });

    it("存在しない取引先の案件は保存できない", async () => {
      await expect(repo.saveProject({ ...projectX, clientId: "nope" })).rejects.toThrow();
    });
  });

  describe("契約", () => {
    beforeEach(async () => {
      await repo.saveClient(clientA);
      await repo.saveProject(projectX);
      await repo.saveProject(projectY);
    });

    it("対象の案件・単価の上書き・目安時間(小数も)を含めて保存して読み戻す", async () => {
      await repo.saveContract(contract1);
      await expect(repo.listContracts()).resolves.toEqual([contract1]);
    });

    it("終了日なし・目安時間なしの契約", async () => {
      const open: Contract = {
        id: "c2",
        clientId: "client-a",
        name: "業務委託契約",
        start: "2027-01-01",
        end: null,
        hourlyRate: 6_000,
        projectIds: ["X"],
        projectRates: {},
        renewalOutlook: "undecided",
      };
      await repo.saveContract(open);
      await expect(repo.listContracts()).resolves.toEqual([open]);
    });

    it("保存し直すと、対象の案件や上書きも入れ替わる", async () => {
      await repo.saveContract(contract1);
      await repo.saveContract({ ...contract1, projectIds: ["X"], projectRates: {}, projectHoursRanges: {} });
      const [c] = await repo.listContracts();
      expect(c).toMatchObject({ projectIds: ["X"], projectRates: {} });
      expect(c?.projectHoursRanges ?? {}).toEqual({});
    });

    it("一覧は開始日の順、取引先で絞り込める", async () => {
      await repo.saveContract({ ...contract1, id: "later", start: "2027-01-01", end: null });
      await repo.saveContract(contract1);
      await expect(repo.listContracts().then((cs) => cs.map((c) => c.id))).resolves.toEqual(["c1", "later"]);
      await expect(repo.listContracts({ clientId: "other" })).resolves.toEqual([]);
    });

    it("ドメインの検証に通らない契約は保存しない(同じ案件の期間が重なる)", async () => {
      await repo.saveContract(contract1);
      await expect(repo.saveContract({ ...contract1, id: "c2" })).rejects.toThrow(RangeError);
      await expect(repo.listContracts()).resolves.toHaveLength(1);
    });

    it("月の目安時間の上書きを保存して読み戻す(契約全体と案件ごと)", async () => {
      await repo.saveContract(contract1);
      await repo.saveHoursRangeOverride({ contractId: "c1", projectId: null, month: "2026-12", range: { maxHours: 200 }, note: "年末" });
      await repo.saveHoursRangeOverride({ contractId: "c1", projectId: "Y", month: "2026-12", range: { maxHours: 50 }, note: "" });
      await expect(repo.listHoursRangeOverrides({ month: "2026-12" })).resolves.toEqual([
        { contractId: "c1", projectId: null, month: "2026-12", range: { maxHours: 200 }, note: "年末" },
        { contractId: "c1", projectId: "Y", month: "2026-12", range: { maxHours: 50 }, note: "" },
      ]);
    });

    it("同じ契約・案件・月の上書きは保存し直すと上書きする", async () => {
      await repo.saveContract(contract1);
      await repo.saveHoursRangeOverride({ contractId: "c1", projectId: null, month: "2026-12", range: { maxHours: 200 }, note: "" });
      await repo.saveHoursRangeOverride({ contractId: "c1", projectId: null, month: "2026-12", range: { maxHours: 210 }, note: "再合意" });
      await expect(repo.listHoursRangeOverrides({ month: "2026-12" })).resolves.toEqual([
        { contractId: "c1", projectId: null, month: "2026-12", range: { maxHours: 210 }, note: "再合意" },
      ]);
    });
  });

  describe("稼働(solidtime から取り込んだ打刻)", () => {
    beforeEach(async () => {
      await repo.saveClient(clientA);
      await repo.saveProject(projectX);
    });

    const entry = (id: string, date: string, seconds: number, billable = true) => ({
      id,
      solidtimeProjectId: "st-x",
      date,
      seconds,
      billable,
    });

    it("期間を指定して入れ替え、案件 × 日の請求対象の合計を読む", async () => {
      await repo.replaceTimeEntries({ from: "2026-11-01", to: "2026-11-30" }, [
        entry("e1", "2026-11-02", 3_600),
        entry("e2", "2026-11-02", 1_800),
        entry("e3", "2026-11-03", 900, false),
      ]);
      await expect(repo.listDailyWork({ from: "2026-11-01", to: "2026-11-30" })).resolves.toEqual([
        { projectId: "X", date: "2026-11-02", seconds: 5_400 },
      ]);
    });

    it("入れ替えは期間の中だけ消す(期間の外は残す)", async () => {
      await repo.replaceTimeEntries({ from: "2026-10-01", to: "2026-11-30" }, [
        entry("old", "2026-10-15", 3_600),
        entry("e1", "2026-11-02", 3_600),
      ]);
      await repo.replaceTimeEntries({ from: "2026-11-01", to: "2026-11-30" }, [entry("e2", "2026-11-05", 600)]);
      await expect(repo.listDailyWork({ from: "2026-10-01", to: "2026-11-30" })).resolves.toEqual([
        { projectId: "X", date: "2026-10-15", seconds: 3_600 },
        { projectId: "X", date: "2026-11-05", seconds: 600 },
      ]);
    });

    it("このシステムの案件に結びついていない打刻は保存するが、合計には出さない", async () => {
      await repo.replaceTimeEntries({ from: "2026-11-01", to: "2026-11-30" }, [
        { ...entry("e1", "2026-11-02", 3_600), solidtimeProjectId: "unknown" },
      ]);
      await expect(repo.listDailyWork({ from: "2026-11-01", to: "2026-11-30" })).resolves.toEqual([]);
      await expect(repo.listUnlinkedSolidtimeProjects({ from: "2026-11-01", to: "2026-11-30" })).resolves.toEqual([
        { solidtimeProjectId: "unknown", seconds: 3_600 },
      ]);
    });

    it("期間の外の日付の打刻は受け付けない(入れ替えの範囲と食い違うため)", async () => {
      await expect(
        repo.replaceTimeEntries({ from: "2026-11-01", to: "2026-11-30" }, [entry("e1", "2026-12-01", 60)]),
      ).rejects.toThrow(RangeError);
    });

    it("途中で失敗したら何も変えない(トランザクション)", async () => {
      await repo.replaceTimeEntries({ from: "2026-11-01", to: "2026-11-30" }, [entry("e1", "2026-11-02", 3_600)]);
      await expect(
        repo.replaceTimeEntries({ from: "2026-11-01", to: "2026-11-30" }, [
          entry("e2", "2026-11-03", 60),
          entry("e2", "2026-11-04", 60), // id の重複
        ]),
      ).rejects.toThrow();
      await expect(repo.listDailyWork({ from: "2026-11-01", to: "2026-11-30" })).resolves.toEqual([
        { projectId: "X", date: "2026-11-02", seconds: 3_600 },
      ]);
    });
  });

  describe("不在(Calendar から取り込んだ日ごとの秒数)", () => {
    it("期間を指定して入れ替え、読み戻す", async () => {
      await repo.replaceAbsences({ from: "2026-11-01", to: "2026-11-30" }, { "2026-11-09": 18_000, "2026-11-10": 86_400 });
      await repo.replaceAbsences({ from: "2026-11-10", to: "2026-11-30" }, { "2026-11-20": 3_600 });
      await expect(repo.listAbsences({ from: "2026-11-01", to: "2026-11-30" })).resolves.toEqual({
        "2026-11-09": 18_000,
        "2026-11-20": 3_600,
      });
    });
  });

  describe("同期の記録", () => {
    it("最後の成功と最後の失敗を source ごとに読む", async () => {
      await repo.recordSync({ source: "solidtime", status: "success", finishedAt: "2026-11-05T09:00:00Z", error: null });
      await repo.recordSync({ source: "solidtime", status: "failure", finishedAt: "2026-11-05T10:00:00Z", error: "HTTP 500" });
      await repo.recordSync({ source: "calendar", status: "success", finishedAt: "2026-11-05T09:30:00Z", error: null });
      await expect(repo.getSyncStatus("solidtime")).resolves.toEqual({
        lastSuccessAt: "2026-11-05T09:00:00Z",
        lastFailure: { at: "2026-11-05T10:00:00Z", error: "HTTP 500" },
      });
      await expect(repo.getSyncStatus("drive")).resolves.toEqual({ lastSuccessAt: null, lastFailure: null });
    });
  });
});
