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
  archived: false,
  driveFolderId: null,
};

const projectX: ProjectRecord = {
  id: "X",
  clientId: "client-a",
  name: "案件 X",
  archived: false,
  hourlyRate: 5_000,
  driveFolderId: null,
};
const projectY: ProjectRecord = { ...projectX, id: "Y", name: "案件 Y", hourlyRate: 7_000 };

const contract1: Contract = {
  id: "c1",
  clientId: "client-a",
  name: "業務委託契約",
  start: "2026-10-01",
  end: "2026-12-31",
  projectIds: ["X", "Y"],

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

  describe("solidtime カタログと請求設定", () => {
    it("取り込み時に請求設定を初期化し、次の同期では請求設定と Drive を保持する", async () => {
      await repo.syncSolidtimeCatalog({ clients: [clientA], projects: [projectX, projectY] });
      await expect(repo.getClient("client-a")).resolves.toEqual(clientA);
      const billing = { ...clientA, paymentTerms: { closingDay: 31, paymentMonthOffset: 2, paymentDay: 30 }, lineGrouping: "contract" as const };
      await repo.updateClientBilling("client-a", billing);
      await repo.setClientDriveFolder("client-a", "client-folder");
      await repo.setProjectDriveFolder("X", "project-folder");
      await repo.syncSolidtimeCatalog({ clients: [{ ...clientA, name: "A 株式会社" }], projects: [{ ...projectX, name: "案件 新", hourlyRate: 6500.25 }] });
      await expect(repo.getClient("client-a")).resolves.toEqual({ ...billing, name: "A 株式会社", driveFolderId: "client-folder" });
      await expect(repo.listProjects()).resolves.toEqual([{ ...projectX, name: "案件 新", hourlyRate: 6500.25, driveFolderId: "project-folder" }]);
      expect((await repo.listProjects({ includeArchived: true })).find((p) => p.id === "Y")).toEqual({ ...projectY, archived: true });
    });

    it("名前順で返し、取引先とアーカイブで絞り込む", async () => {
      await repo.syncSolidtimeCatalog({
        clients: [{ ...clientA, id: "b", name: "B 社" }, clientA],
        projects: [projectY, projectX, { ...projectX, id: "old", name: "終了案件", archived: true }],
      });
      expect((await repo.listClients()).map((c) => c.name)).toEqual(["A 社", "B 社"]);
      await expect(repo.listProjects()).resolves.toEqual([projectX, projectY]);
      await expect(repo.listProjects({ clientId: "client-a", includeArchived: true })).resolves.toHaveLength(3);
      await expect(repo.listProjects({ clientId: "other", includeArchived: true })).resolves.toEqual([]);
    });

    it("存在しない取引先は取得できず、請求設定も更新できない", async () => {
      await expect(repo.getClient("nope")).resolves.toBeNull();
      await expect(repo.updateClientBilling("nope", clientA)).rejects.toThrow(RangeError);
    });

    it.each([
      { closingDay: 0, paymentMonthOffset: 1, paymentDay: "end" },
      { closingDay: 1.5, paymentMonthOffset: 1, paymentDay: "end" },
      { closingDay: "end", paymentMonthOffset: -1, paymentDay: "end" },
      { closingDay: "end", paymentMonthOffset: 1, paymentDay: 32 },
    ] as const)("不正な支払条件 %o は保存しない", async (paymentTerms) => {
      await repo.syncSolidtimeCatalog({ clients: [clientA], projects: [] });
      await expect(repo.updateClientBilling("client-a", { ...clientA, paymentTerms })).rejects.toThrow(RangeError);
      await expect(repo.getClient("client-a")).resolves.toEqual(clientA);
    });

    it("solidtime から消えた取引先・案件をアーカイブし、再登場したら復帰する", async () => {
      const catalog = { clients: [clientA], projects: [projectX] };
      await repo.syncSolidtimeCatalog(catalog);
      await repo.syncSolidtimeCatalog({ clients: [], projects: [] });
      await expect(repo.getClient("client-a")).resolves.toEqual({ ...clientA, archived: true });
      await expect(repo.listProjects()).resolves.toEqual([]);
      await expect(repo.listProjects({ includeArchived: true })).resolves.toEqual([{ ...projectX, archived: true }]);
      await repo.syncSolidtimeCatalog(catalog);
      await expect(repo.listProjects()).resolves.toEqual([projectX]);
    });

    it("案件の取引先は契約の有無にかかわらず solidtime の変更に従う", async () => {
      const clients = [clientA, { ...clientA, id: "client-b", name: "B 社" }];
      await repo.syncSolidtimeCatalog({ clients, projects: [projectX] });
      await repo.saveContract({ ...contract1, projectIds: ["X"], projectHoursRanges: {} });
      await repo.syncSolidtimeCatalog({ clients, projects: [{ ...projectX, clientId: "client-b" }] });
      await expect(repo.listProjects({ clientId: "client-b" })).resolves.toEqual([{ ...projectX, clientId: "client-b" }]);
      await expect(repo.listContracts()).resolves.toHaveLength(1);
    });

    it("取引先なしと単価なしの案件も取り込む", async () => {
      await repo.syncSolidtimeCatalog({ clients: [], projects: [{ ...projectX, clientId: null, hourlyRate: null }] });
      await expect(repo.listProjects()).resolves.toEqual([{ ...projectX, clientId: null, hourlyRate: null }]);
    });

    it("カタログ途中で失敗したら、既存のカタログを変更しない", async () => {
      await repo.syncSolidtimeCatalog({ clients: [clientA], projects: [projectX] });
      await expect(repo.syncSolidtimeCatalog({ clients: [], projects: [{ ...projectX, clientId: "nope" }] })).rejects.toThrow();
      await expect(repo.getClient("client-a")).resolves.toEqual(clientA);
      await expect(repo.listProjects()).resolves.toEqual([projectX]);
    });

    it("打刻の保存失敗でも、カタログと前回の打刻をまとめて戻す", async () => {
      const period = { from: "2026-11-01", to: "2026-11-30" };
      const entry = { id: "e1", solidtimeProjectId: "X", date: "2026-11-01", seconds: 3600, billable: true };
      await repo.replaceSolidtimeData({ clients: [clientA], projects: [projectX] }, period, [entry]);
      await expect(repo.replaceSolidtimeData({ clients: [], projects: [] }, period, [entry, entry])).rejects.toThrow();
      await expect(repo.getClient("client-a")).resolves.toEqual(clientA);
      await expect(repo.listProjects()).resolves.toEqual([projectX]);
      await expect(repo.listDailyWork(period)).resolves.toEqual([{ projectId: "X", date: "2026-11-01", seconds: 3600 }]);
    });
  });

  describe("契約", () => {
    beforeEach(async () => {
      await repo.syncSolidtimeCatalog({ clients: [clientA], projects: [projectX, projectY] });
    });

    it("対象の案件・目安時間(小数も)を含めて保存して読み戻す", async () => {
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
        projectIds: ["X"],

        renewalOutlook: "undecided",
      };
      await repo.saveContract(open);
      await expect(repo.listContracts()).resolves.toEqual([open]);
    });

    it("保存し直すと、対象の案件や上書きも入れ替わる", async () => {
      await repo.saveContract(contract1);
      await repo.saveContract({ ...contract1, projectIds: ["X"], projectHoursRanges: {} });
      const [c] = await repo.listContracts();
      expect(c).toMatchObject({ projectIds: ["X"] });
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
      await repo.syncSolidtimeCatalog({ clients: [clientA], projects: [projectX] });
    });

    const entry = (id: string, date: string, seconds: number, billable = true) => ({
      id,
      solidtimeProjectId: "X",
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

    it("プロジェクトなし・未取り込みだけを未連携とし、アーカイブ済みの実績は集計する", async () => {
      const period = { from: "2026-11-01", to: "2026-11-30" };
      await repo.syncSolidtimeCatalog({ clients: [clientA], projects: [{ ...projectX, archived: true }] });
      await repo.replaceTimeEntries(period, [
        entry("a", "2026-11-01", 3600),
        { ...entry("b", "2026-11-01", 1800), solidtimeProjectId: null },
        { ...entry("c", "2026-11-01", 900), solidtimeProjectId: "unknown" },
        { ...entry("d", "2026-11-01", 600, false), solidtimeProjectId: null },
      ]);
      await expect(repo.listDailyWork(period)).resolves.toEqual([{ projectId: "X", date: "2026-11-01", seconds: 3600 }]);
      await expect(repo.listUnlinkedSolidtimeProjects(period)).resolves.toEqual([
        { solidtimeProjectId: null, seconds: 1800 }, { solidtimeProjectId: "unknown", seconds: 900 },
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
  it.each([
    { ...clientA, subjectTemplate: " \t " },
    { ...clientA, paymentTerms: { closingDay: "end" as const, paymentMonthOffset: 0, paymentDay: 30 } },
  ])("請求設定を拒否したら前の設定が残る: %o", async (billing) => {
    await repo.syncSolidtimeCatalog({ clients: [clientA], projects: [] });
    const before = await repo.getClient("client-a");
    await expect(repo.updateClientBilling("client-a", billing)).rejects.toThrow(RangeError);
    expect(await repo.getClient("client-a")).toEqual(before);
  });

  it("取引先が変わった案件は既存契約に残せるが、外した後の再追加や別契約には入れられない", async () => {
    const clients = [clientA, { ...clientA, id: "client-b", name: "B 社" }];
    await repo.syncSolidtimeCatalog({ clients, projects: [projectX, projectY] });
    await repo.saveContract(contract1);
    await repo.saveHoursRangeOverride({ contractId: "c1", projectId: "Y", month: "2026-11", range: { maxHours: 20 }, note: "合意" });
    await repo.syncSolidtimeCatalog({ clients, projects: [projectX, { ...projectY, clientId: "client-b" }] });
    const updated = { ...contract1, end: "2026-11-30" };
    await repo.saveContract(updated);
    expect(await repo.listContracts()).toEqual([updated]);
    await expect(repo.saveContract({ ...updated, clientId: "client-b" })).rejects.toThrow(RangeError);
    await expect(repo.saveContract({ ...updated, id: "new", start: "2027-01-01", end: null })).rejects.toThrow(RangeError);
    await repo.saveContract({ ...updated, projectIds: ["X"], projectHoursRanges: {} });
    expect(await repo.listHoursRangeOverrides()).toEqual([]);
    await expect(repo.saveContract(updated)).rejects.toThrow(RangeError);
  });

});
