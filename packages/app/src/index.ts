import type { Repository, SyncSource } from "@fpm/db";
import {
  contractCoverage,
  forecastDays,
  invoiceGuide as buildInvoiceGuide,
  monthOutlook,
  rateFor,
} from "@fpm/domain";
import {
  absenceSecondsByDay,
  type CalendarClient,
  type DriveClient,
  type UploadFileOptions,
} from "@fpm/google";
import type { SolidtimeClient } from "@fpm/solidtime";
import { addDays, dateInTimeZone, forecastPeriods, monthPeriod } from "./dates.ts";

export interface AppDeps {
  readonly repo: Repository;
  readonly solidtime: Pick<SolidtimeClient, "listTimeEntries"> & {
    // 単価更新のレスポンスは使わない。実クライアントと最小のフェイクを受け取る。
    setProjectRate(...args: Parameters<SolidtimeClient["setProjectRate"]>): Promise<unknown>;
  };
  readonly calendar: Pick<CalendarClient, "listOutOfOffice">;
  readonly drive: Pick<DriveClient, "ensureFolder" | "uploadFile" | "listFiles">;
  readonly clock: { now(): Date };
  readonly config: {
    readonly timeZone: string;
    readonly forecastWeeks: number;
    readonly forecastMonths: number;
    readonly driveRootFolderId: string;
  };
}

type SyncResult<T> = ({ readonly ok: true } & T) | { readonly ok: false; readonly error: string };

// Share locks across app instances in this process; each source runs independently.
const syncingSources = new Set<SyncSource>();

interface RatePushResult {
  readonly pushed: { projectId: string; hourlyRate: number }[];
  readonly skipped: (
    | { projectId: null; reason: "notActiveToday" }
    | { projectId: string; reason: "noSolidtimeProject" }
  )[];
}

export function createApp({ repo, solidtime, calendar, drive, clock, config }: AppDeps) {
  const today = () => dateInTimeZone(clock.now(), config.timeZone);
  const historyStart = (asOf: string) => addDays(asOf, -7 * config.forecastWeeks);
  const forecastEnd = (asOf: string) => forecastPeriods(asOf, config.forecastMonths).at(-1)!.to;

  async function sync<T extends object>(
    source: SyncSource,
    importData: () => Promise<T>,
  ): Promise<SyncResult<T>> {
    if (syncingSources.has(source)) return { ok: false, error: "busy" };
    syncingSources.add(source);
    try {
      const result = await importData();
      await repo.recordSync({ source, status: "success", finishedAt: clock.now().toISOString(), error: null });
      return { ok: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await repo.recordSync({ source, status: "failure", finishedAt: clock.now().toISOString(), error: message });
      } catch {
        // 記録先も利用できない場合でも、同期のエラーは例外にせず呼び出し元に返す。
      }
      return { ok: false, error: message };
    } finally {
      syncingSources.delete(source);
    }
  }

  async function ensureProjectFolder(projectId: string): Promise<{ folderId: string }> {
    const project = (await repo.listProjects()).find((candidate) => candidate.id === projectId);
    if (!project) throw new RangeError(`Project not found: ${projectId}`);
    if (project.driveFolderId !== null) return { folderId: project.driveFolderId };

    const client = await repo.getClient(project.clientId);
    if (!client) throw new RangeError(`Client not found: ${project.clientId}`);
    let clientFolderId = client.driveFolderId;
    if (clientFolderId === null) {
      const folder = await drive.ensureFolder({ parentId: config.driveRootFolderId, name: client.name });
      clientFolderId = folder.id;
      await repo.saveClient({ ...client, driveFolderId: clientFolderId });
    }
    const folder = await drive.ensureFolder({ parentId: clientFolderId, name: project.name });
    await repo.saveProject({ ...project, driveFolderId: folder.id });
    return { folderId: folder.id };
  }

  return {
    syncSolidtime() {
      return sync("solidtime", async () => {
        const asOf = today();
        const monthStart = `${asOf.slice(0, 7)}-01`;
        const start = historyStart(asOf);
        const period = { from: start < monthStart ? start : monthStart, to: asOf };
        const entries = await solidtime.listTimeEntries(period);
        await repo.replaceTimeEntries(period, entries.map((entry) => ({
          id: entry.id,
          solidtimeProjectId: entry.projectId,
          date: entry.date,
          seconds: entry.seconds,
          billable: entry.billable,
          start: entry.start,
          end: entry.end,
        })));
        return { unlinked: await repo.listUnlinkedSolidtimeProjects(period) };
      });
    },

    syncCalendar() {
      return sync("calendar", async () => {
        const asOf = today();
        const period = { from: asOf, to: forecastEnd(asOf) };
        // UTC の日付境界を両側に 1 日広げ、タイムゾーンによる取りこぼしを防ぐ。
        // 終端は最終日の翌日が基準なので、さらに 1 日広げて +2 日にする。
        const events = await calendar.listOutOfOffice({
          timeMin: `${addDays(period.from, -1)}T00:00:00Z`,
          timeMax: `${addDays(period.to, 2)}T00:00:00Z`,
        });
        const absences = absenceSecondsByDay(events, { ...period, timeZone: config.timeZone });
        await repo.replaceAbsences(period, absences);
        return {};
      });
    },

    async pushRates(contractId: string): Promise<RatePushResult> {
      const contracts = await repo.listContracts();
      const contract = contracts.find((candidate) => candidate.id === contractId);
      if (!contract) throw new RangeError(`Contract not found: ${contractId}`);
      const asOf = today();
      if (!contract.projectIds.every((projectId) =>
        contractCoverage(contracts, projectId, asOf)?.contract.id === contractId,
      )) {
        return { pushed: [], skipped: [{ projectId: null, reason: "notActiveToday" }] };
      }

      const projects = new Map((await repo.listProjects({ clientId: contract.clientId }))
        .map((project) => [project.id, project]));
      const result: RatePushResult = { pushed: [], skipped: [] };
      for (const projectId of contract.projectIds) {
        const solidtimeProjectId = projects.get(projectId)?.solidtimeProjectId;
        if (solidtimeProjectId == null) {
          result.skipped.push({ projectId, reason: "noSolidtimeProject" });
          continue;
        }
        const hourlyRate = rateFor(contract, projectId);
        await solidtime.setProjectRate(solidtimeProjectId, hourlyRate);
        result.pushed.push({ projectId, hourlyRate });
      }
      return result;
    },

    async dashboard() {
      const asOf = today();
      const periods = forecastPeriods(asOf, config.forecastMonths);
      const until = periods.at(-1)!.to;
      const previousMonthStart = `${addDays(`${asOf.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
      const [projects, contracts, history, absenceSeconds, solidtimeStatus, calendarStatus, unlinked] = await Promise.all([
        repo.listProjects(),
        repo.listContracts(),
        repo.listDailyWork({ from: historyStart(asOf), to: asOf }),
        repo.listAbsences({ from: asOf, to: until }),
        repo.getSyncStatus("solidtime"),
        repo.getSyncStatus("calendar"),
        repo.listUnlinkedSolidtimeProjects({ from: previousMonthStart, to: asOf }),
      ]);
      const forecast = forecastDays({
        asOf,
        until,
        weeks: config.forecastWeeks,
        projects: projects.map((project) => ({
          projectId: project.id,
          clientId: project.clientId,
          history: history.filter((work) => work.projectId === project.id),
        })),
        contracts,
        absenceSeconds,
      });
      const months = await Promise.all(periods.map(async ({ month, from, to }) => {
        const [actual, hoursRangeOverrides] = await Promise.all([
          repo.listDailyWork({ from, to }),
          repo.listHoursRangeOverrides({ month }),
        ]);
        return {
          month,
          contracts: monthOutlook({ month, asOf, contracts, actual, forecast, hoursRangeOverrides }),
        };
      }));
      return {
        asOf,
        projectNames: Object.fromEntries(projects.map((project) => [project.id, project.name])),
        unlinked,
        months,
        sync: { solidtime: solidtimeStatus, calendar: calendarStatus },
      };
    },

    async invoiceGuide({ clientId, month }: { clientId: string; month: string }) {
      const client = await repo.getClient(clientId);
      if (!client) throw new RangeError(`Client not found: ${clientId}`);
      const [contracts, projects, work] = await Promise.all([
        repo.listContracts({ clientId }),
        repo.listProjects({ clientId }),
        repo.listDailyWork(monthPeriod(month)),
      ]);
      return buildInvoiceGuide({
        month,
        client,
        contracts,
        projects: projects.map((project) => ({
          ...project,
          work: work.filter((entry) => entry.projectId === project.id),
        })),
      });
    },

    ensureProjectFolder,

    async uploadDocument({ projectId, ...file }: Omit<UploadFileOptions, "folderId"> & { projectId: string }) {
      const { folderId } = await ensureProjectFolder(projectId);
      const uploaded = await drive.uploadFile({ ...file, folderId });
      return { fileId: uploaded.id, webViewLink: uploaded.webViewLink };
    },
  };
}
