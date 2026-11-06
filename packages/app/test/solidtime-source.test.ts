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
const stEntry = (id: string, projectId: string | null, date: string, seconds: number) => ({
  id,
  projectId,
  date,
  seconds,
  billable: true,
  start: `${date}T00:00:00Z`,
  end: `${date}T01:00:00Z`,
  description: null,
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
    listTimeEntries: vi.fn(async () => [
      ...mondays.map((d, i) => stEntry(`x${i}`, "st-x", d, 4 * HOUR)),
      ...mondays.map((d, i) => stEntry(`o${i}`, "st-old", d, 2 * HOUR)),
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

  it("請求書ガイドの単価は、取り込んだ案件の単価", async () => {
    f.solidtime.listTimeEntries.mockResolvedValue([stEntry("a", "st-x", "2026-11-10", 10 * HOUR)]);
    await app.syncSolidtime();
    await repo.saveContract(contract);
    const guide = await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" });
    expect(guide?.lines).toEqual([{ item: "案件 st-x 2026年11月分", quantity: 10, unit: "時間", unitPrice: 5_000, amount: 50_000 }]);
    expect(guide?.warnings).toEqual([]);
  });

  it("単価が未設定の案件は明細に入れず、警告で知らせる", async () => {
    f.solidtime.listTimeEntries.mockResolvedValue([
      stEntry("a", "st-x", "2026-11-10", 10 * HOUR),
      stEntry("b", "st-norate", "2026-11-10", 3 * HOUR),
    ]);
    await app.syncSolidtime();
    await repo.saveContract({ ...contract, projectIds: ["st-x", "st-norate"] });
    const guide = await app.invoiceGuide({ clientId: "st-client-a", month: "2026-11" });
    expect(guide?.lines.map((l) => l.item)).toEqual(["案件 st-x 2026年11月分"]);
    expect(guide?.warnings).toEqual([{ kind: "missingRate", projectId: "st-norate", projectName: "案件 st-norate", seconds: 3 * HOUR }]);
    expect(guide?.subtotal).toBe(50_000);
  });

  it("アーカイブした案件も、稼働があれば請求書ガイドに出す", async () => {
    f.solidtime.listTimeEntries.mockResolvedValue([stEntry("a", "st-old", "2026-11-10", 2 * HOUR)]);
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
});
