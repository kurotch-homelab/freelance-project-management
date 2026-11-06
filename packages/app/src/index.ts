import type { ClientBilling, Repository, SyncSource } from "@fpm/db";
import {
  contractCoverage,
  contractsForCurrentProjects,
  forecastDays,
  invoiceGuide as buildInvoiceGuide,
  monthOutlook,
  validateClientBilling,
  groupInvoiceWork,
  summarizeInvoice,
  type InvoiceWork,
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
  readonly solidtime: Pick<SolidtimeClient, "listTimeEntries" | "listClients" | "listProjectsWithRates">;
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
    const project = (await repo.listProjects({ includeArchived: true })).find((candidate) => candidate.id === projectId);
    if (!project) throw new RangeError(`Project not found: ${projectId}`);
    if (project.driveFolderId !== null) return { folderId: project.driveFolderId };

    if (project.clientId === null) throw new RangeError(`Project has no client: ${projectId}`);
    const client = await repo.getClient(project.clientId);
    if (!client) throw new RangeError(`Client not found: ${project.clientId}`);
    let clientFolderId = client.driveFolderId;
    if (clientFolderId === null) {
      const folder = await drive.ensureFolder({ parentId: config.driveRootFolderId, name: client.name });
      clientFolderId = folder.id;
      await repo.setClientDriveFolder(client.id, clientFolderId);
    }
    const folder = await drive.ensureFolder({ parentId: clientFolderId, name: project.name });
    await repo.setProjectDriveFolder(project.id, folder.id);
    return { folderId: folder.id };
  }

  return {
    syncSolidtime() {
      return sync("solidtime", async () => {
        const asOf = today();
        const previousMonthStart = `${addDays(`${asOf.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
        const start = historyStart(asOf);
        const period = { from: start < previousMonthStart ? start : previousMonthStart, to: asOf };
        const clients = await solidtime.listClients();
        const projects = await solidtime.listProjectsWithRates();
        const entries = await solidtime.listTimeEntries(period);
        await repo.replaceSolidtimeData({
          clients: clients.map(({ id, name, isArchived }) => ({ id, name, archived: isArchived })),
          projects: projects.map(({ id, clientId, name, isArchived, hourlyRate }) => ({
            id, clientId, name, archived: isArchived, hourlyRate,
          })),
        }, period, entries.filter((entry) => entry.date >= period.from && entry.date <= period.to).map((entry) => ({
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

    async updateClientBilling(clientId: string, billing: ClientBilling) {
      validateClientBilling(billing);
      await repo.updateClientBilling(clientId, billing);
    },

    async dashboard() {
      const asOf = today();
      const periods = forecastPeriods(asOf, config.forecastMonths);
      const until = periods.at(-1)!.to;
      const previousMonthStart = `${addDays(`${asOf.slice(0, 7)}-01`, -1).slice(0, 7)}-01`;
      const [projects, savedContracts, history, absenceSeconds, solidtimeStatus, calendarStatus, unlinked, clients, recentWork] = await Promise.all([
        repo.listProjects({ includeArchived: true }),
        repo.listContracts(),
        repo.listDailyWork({ from: historyStart(asOf), to: asOf }),
        repo.listAbsences({ from: asOf, to: until }),
        repo.getSyncStatus("solidtime"),
        repo.getSyncStatus("calendar"),
        repo.listUnlinkedSolidtimeProjects({ from: previousMonthStart, to: asOf }),
        repo.listClients(),
        repo.listDailyWork({ from: previousMonthStart, to: asOf }),
      ]);
      const projectById = new Map(projects.map((project) => [project.id, project]));
      const contracts = contractsForCurrentProjects(savedContracts, projects);
      const contractProjectMismatches = savedContracts.flatMap((contract) => contract.projectIds.flatMap((id) => {
        const project = projectById.get(id);
        return project && project.clientId !== contract.clientId ? [{
          contractId: contract.id, contractName: contract.name,
          projectId: id, projectName: project.name, projectClientId: project.clientId,
        }] : [];
      }));
      const recentProjectIds = new Set(recentWork.filter((work) => work.seconds > 0).map((work) => work.projectId));
      const warningProjects = projects.filter((project) => !project.archived || recentProjectIds.has(project.id));
      const uncovered = new Map<string, number>();
      for (const work of recentWork) {
        if (work.date.slice(0, 7) !== asOf.slice(0, 7) || work.seconds === 0) continue;
        const coverage = contractCoverage(contracts, work.projectId, work.date);
        if (coverage === null || coverage.assumesRenewal) {
          uncovered.set(work.projectId, (uncovered.get(work.projectId) ?? 0) + work.seconds);
        }
      }
      const forecast = forecastDays({
        asOf,
        until,
        weeks: config.forecastWeeks,
        projects: projects.map((project) => ({
          projectId: project.id,
          clientId: project.clientId,
          archived: project.archived,
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
        // 実績は当日まで、予測は翌日から。実績には更新前提の契約を当てない。
        const work: InvoiceWork[] = [
          ...actual.filter((row) => row.date <= asOf).map((row) => {
            const coverage = contractCoverage(contracts, row.projectId, row.date);
            return {
              ...row, contractId: coverage !== null && !coverage.assumesRenewal ? coverage.contract.id : null,
              hourlyRate: projectById.get(row.projectId)?.hourlyRate ?? null,
            };
          }),
          ...forecast.filter((row) => row.date.slice(0, 7) === month).map((row) => ({
            ...row, contractId: contractCoverage(contracts, row.projectId, row.date)?.contract.id ?? null,
            hourlyRate: projectById.get(row.projectId)?.hourlyRate ?? null,
          })),
        ];
        const outlook = monthOutlook({
          month, asOf, contracts, projects,
          actual: actual.filter((row) => {
            const coverage = contractCoverage(contracts, row.projectId, row.date);
            return coverage !== null && !coverage.assumesRenewal;
          }),
          forecast,
          hoursRangeOverrides: hoursRangeOverrides.filter((override) => contracts.some((contract) =>
            contract.id === override.contractId && (override.projectId === null || contract.projectIds.includes(override.projectId)),
          )),
        });
        return {
          month,
          contracts: outlook.map((contract) => {
            const clientId = contracts.find((saved) => saved.id === contract.contractId)!.clientId;
            const grouping = clients.find((client) => client.id === clientId)!.lineGrouping;
            const { subtotal } = summarizeInvoice(groupInvoiceWork(work.filter((row) => row.contractId === contract.contractId), grouping));
            return { ...contract, estimate: { subtotal } };
          }),
          clients: clients.flatMap((client) => {
            const groups = groupInvoiceWork(work.filter((row) => projectById.get(row.projectId)?.clientId === client.id), client.lineGrouping);
            if (groups.length === 0) return [];
            const { subtotal, tax, total } = summarizeInvoice(groups);
            return [{ clientId: client.id, clientName: client.name, estimate: { subtotal, tax, total } }];
          }),
        };
      }));
      return {
        asOf,
        projectNames: Object.fromEntries(projects.map((project) => [project.id, project.name])),
        unlinked,
        contractProjectMismatches,
        workWithoutContract: projects.flatMap(({ id, name }) => uncovered.has(id) ? [{ projectId: id, name, seconds: uncovered.get(id)! }] : []),
        projectsWithoutClient: warningProjects.filter((p) => p.clientId === null).map(({ id, name }) => ({ id, name })),
        projectsWithoutRate: warningProjects.filter((p) => p.hourlyRate === null).map(({ id, name }) => ({ id, name })),
        months,
        sync: { solidtime: solidtimeStatus, calendar: calendarStatus },
      };
    },

    async invoiceGuide({ clientId, month }: { clientId: string; month: string }) {
      const client = await repo.getClient(clientId);
      if (!client) throw new RangeError(`Client not found: ${clientId}`);
      const [contracts, projects, work] = await Promise.all([
        repo.listContracts({ clientId }),
        repo.listProjects({ clientId, includeArchived: true }),
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
