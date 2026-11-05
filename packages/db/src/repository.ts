import { randomUUID } from "node:crypto";
import { effectiveHoursRange, validateContracts, validatePaymentTerms, type Contract, type HoursRange } from "@fpm/domain";
import type { Selectable } from "kysely";
import type { Database } from "./database.ts";
import type { ClientsTable, ProjectsTable, StoredInteger } from "./schema.ts";
import type {
  ClientFilter, ClientRecord, DateRange, ProjectRecord, Repository, SyncStatus,
} from "./types.ts";

// Code-unit order is independent of the database collation and host locale.
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNullable(a: string | null, b: string | null): number {
  return a === b ? 0 : a === null ? -1 : b === null ? 1 : compare(a, b);
}

function integer(value: StoredInteger): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError("Amounts and seconds must be non-negative safe integers");
  }
  return result;
}

function hoursToSeconds(hours: number | undefined): number | null {
  return hours === undefined ? null : integer(Math.round(hours * 3_600));
}

function rangeColumns(range: HoursRange | undefined) {
  return { min_seconds: hoursToSeconds(range?.minHours), max_seconds: hoursToSeconds(range?.maxHours) };
}

function readRange(min: StoredInteger | null, max: StoredInteger | null): HoursRange {
  return {
    ...(min === null ? {} : { minHours: integer(min) / 3_600 }),
    ...(max === null ? {} : { maxHours: integer(max) / 3_600 }),
  };
}

function assertDate(value: string): void {
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== value) {
    throw new RangeError("Date must be a valid YYYY-MM-DD string");
  }
}

function assertPeriod({ from, to }: DateRange): void {
  assertDate(from);
  assertDate(to);
  if (from > to) throw new RangeError("from must not be after to");
}

function assertWithinPeriod(date: string, { from, to }: DateRange): void {
  assertDate(date);
  if (date < from || date > to) throw new RangeError("Date must be inside the replacement period");
}

function assertTimestamp(value: string): void {
  assertDate(value.slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))) {
    throw new RangeError("Timestamp must be an ISO 8601 string with a time zone");
  }
}

function* batches<T>(rows: readonly T[]): Generator<T[]> {
  // Stay below SQLite's parameter limit even for large imports.
  for (let index = 0; index < rows.length; index += 100) yield rows.slice(index, index + 100);
}

function readClient(row: Selectable<ClientsTable>): ClientRecord {
  return {
    id: row.id,
    name: row.name,
    paymentTerms: {
      closingDay: row.closing_day === "end" ? "end" : Number(row.closing_day),
      paymentMonthOffset: row.payment_month_offset,
      paymentDay: row.payment_day === "end" ? "end" : Number(row.payment_day),
    },
    subjectTemplate: row.subject_template,
    lineGrouping: row.line_grouping,
    solidtimeClientId: row.solidtime_client_id,
    driveFolderId: row.drive_folder_id,
  };
}

function readProject(row: Selectable<ProjectsTable>): ProjectRecord {
  return {
    id: row.id, clientId: row.client_id, name: row.name, status: row.status,
    solidtimeProjectId: row.solidtime_project_id, driveFolderId: row.drive_folder_id,
  };
}

async function readContracts(db: Database, filter: ClientFilter = {}): Promise<Contract[]> {
  // A single query keeps the contract and its projects in the same read snapshot.
  let query = db.selectFrom("contracts as c")
    .innerJoin("contract_projects as p", "p.contract_id", "c.id")
    .selectAll("c")
    .select([
      "p.project_id", "p.position", "p.hourly_rate as project_rate",
      "p.min_seconds as project_min_seconds", "p.max_seconds as project_max_seconds",
      "p.has_hours_range as project_has_hours_range",
    ]);
  if (filter.clientId !== undefined) query = query.where("c.client_id", "=", filter.clientId);
  const rows = await query.execute();
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = grouped.get(row.id);
    if (group) group.push(row);
    else grouped.set(row.id, [row]);
  }
  const contracts: Contract[] = [];
  for (const projects of grouped.values()) {
    projects.sort((a, b) => a.position - b.position || compare(a.project_id, b.project_id));
    const row = projects[0]!;
    contracts.push({
      id: row.id, clientId: row.client_id, name: row.name,
      start: row.start_date, end: row.end_date, hourlyRate: integer(row.hourly_rate),
      projectIds: projects.map((p) => p.project_id),
      projectRates: Object.fromEntries(projects
        .filter((p) => p.project_rate !== null)
        .map((p) => [p.project_id, integer(p.project_rate!)])),
      ...(row.has_hours_range ? { hoursRange: readRange(row.min_seconds, row.max_seconds) } : {}),
      ...(row.has_project_hours_ranges ? {
        projectHoursRanges: Object.fromEntries(projects
          .filter((p) => p.project_has_hours_range)
          .map((p) => [p.project_id, readRange(p.project_min_seconds, p.project_max_seconds)])),
      } : {}),
      renewalOutlook: row.renewal_outlook,
    });
  }
  return contracts.sort((a, b) => compare(a.start, b.start) || compare(a.id, b.id));
}

export function createRepository(db: Database): Repository {
  return {
    async saveClient(client) {
      validatePaymentTerms(client.paymentTerms);
      const row = {
        id: client.id, name: client.name,
        closing_day: String(client.paymentTerms.closingDay),
        payment_month_offset: client.paymentTerms.paymentMonthOffset,
        payment_day: String(client.paymentTerms.paymentDay),
        subject_template: client.subjectTemplate, line_grouping: client.lineGrouping,
        solidtime_client_id: client.solidtimeClientId, drive_folder_id: client.driveFolderId,
      };
      await db.insertInto("clients").values(row).onConflict((c) => c.column("id").doUpdateSet(row)).execute();
    },
    async getClient(id) {
      const row = await db.selectFrom("clients").selectAll().where("id", "=", id).executeTakeFirst();
      return row ? readClient(row) : null;
    },
    async listClients() {
      return (await db.selectFrom("clients").selectAll().execute()).map(readClient)
        .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
    },
    async saveProject(project) {
      const row = {
        id: project.id, client_id: project.clientId, name: project.name, status: project.status,
        solidtime_project_id: project.solidtimeProjectId, drive_folder_id: project.driveFolderId,
      };
      await db.transaction().execute(async (tx) => {
        // Use the same client lock as saveContract before checking membership.
        await tx.updateTable("clients").set((eb) => ({ id: eb.ref("id") }))
          .where("id", "in", tx.selectFrom("projects").select("client_id").where("id", "=", project.id))
          .execute();
        const saved = await tx.selectFrom("projects").select("client_id")
          .where("id", "=", project.id).executeTakeFirst();
        if (saved !== undefined && saved.client_id !== project.clientId) {
          const membership = await tx.selectFrom("contract_projects").select("contract_id")
            .where("project_id", "=", project.id).executeTakeFirst();
          if (membership !== undefined) {
            throw new RangeError("Cannot change the client of a project that belongs to a contract");
          }
        }
        await tx.insertInto("projects").values(row).onConflict((c) => c.column("id").doUpdateSet(row)).execute();
      });
    },
    async listProjects(filter = {}) {
      let query = db.selectFrom("projects").selectAll();
      if (filter.clientId !== undefined) query = query.where("client_id", "=", filter.clientId);
      return (await query.execute()).map(readProject)
        .sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
    },
    async findProjectBySolidtimeId(id) {
      const row = await db.selectFrom("projects").selectAll()
        .where("solidtime_project_id", "=", id).executeTakeFirst();
      return row ? readProject(row) : null;
    },
    listContracts: (filter) => readContracts(db, filter),
    async saveContract(contract) {
      await db.transaction().execute(async (tx) => {
        // Lock the client row before reading contracts. Concurrent PostgreSQL saves
        // for that client's projects must not both pass the overlap validation.
        await tx.updateTable("clients").set({ id: contract.clientId })
          .where("id", "=", contract.clientId).returning("id").executeTakeFirstOrThrow();
        const saved = await readContracts(tx);
        validateContracts([...saved.filter((c) => c.id !== contract.id), contract]);
        const projects = await tx.selectFrom("projects").select(["id", "client_id"])
          .where("id", "in", contract.projectIds).execute();
        if (projects.length !== contract.projectIds.length || projects.some((p) => p.client_id !== contract.clientId)) {
          throw new RangeError("Contract projects must exist and belong to the contract's client");
        }
        const row = {
          id: contract.id, client_id: contract.clientId, name: contract.name,
          start_date: contract.start, end_date: contract.end, hourly_rate: contract.hourlyRate,
          ...rangeColumns(contract.hoursRange),
          has_hours_range: Number(contract.hoursRange !== undefined),
          has_project_hours_ranges: Number(contract.projectHoursRanges !== undefined),
          renewal_outlook: contract.renewalOutlook,
        };
        await tx.insertInto("contracts").values(row).onConflict((c) => c.column("id").doUpdateSet(row)).execute();
        await tx.deleteFrom("hours_range_overrides").where("contract_id", "=", contract.id)
          .where("project_id", "is not", null).where("project_id", "not in", contract.projectIds).execute();
        await tx.deleteFrom("contract_projects").where("contract_id", "=", contract.id).execute();
        const projectRows = contract.projectIds.map((projectId, position) => ({
          contract_id: contract.id, project_id: projectId, position,
          hourly_rate: Object.hasOwn(contract.projectRates, projectId) ? contract.projectRates[projectId]! : null,
          ...rangeColumns(contract.projectHoursRanges?.[projectId]),
          has_hours_range: Number(Object.hasOwn(contract.projectHoursRanges ?? {}, projectId)),
        }));
        for (const batch of batches(projectRows)) await tx.insertInto("contract_projects").values(batch).execute();
      });
    },
    async saveHoursRangeOverride(override) {
      await db.transaction().execute(async (tx) => {
        effectiveHoursRange({}, [override], override.month);
        const row = {
          id: JSON.stringify([override.contractId, override.projectId, override.month]),
          contract_id: override.contractId, project_id: override.projectId, month: override.month,
          ...rangeColumns(override.range), note: override.note, recorded_at: new Date().toISOString(),
        };
        // Serialize membership checks with saveContract, which may remove projects.
        await tx.updateTable("clients").set((eb) => ({ id: eb.ref("id") }))
          .where("id", "in", tx.selectFrom("contracts").select("client_id").where("id", "=", override.contractId))
          .execute();
        if (override.projectId !== null) {
          const project = await tx.selectFrom("contract_projects").select("project_id")
            .where("contract_id", "=", override.contractId).where("project_id", "=", override.projectId).executeTakeFirst();
          if (!project) throw new RangeError("Override project must belong to the contract");
        }
        await tx.insertInto("hours_range_overrides").values(row)
          .onConflict((c) => c.column("id").doUpdateSet(row)).execute();
      });
    },
    async listHoursRangeOverrides(filter = {}) {
      let query = db.selectFrom("hours_range_overrides").selectAll();
      if (filter.month !== undefined) query = query.where("month", "=", filter.month);
      if (filter.contractId !== undefined) query = query.where("contract_id", "=", filter.contractId);
      return (await query.execute()).map((row) => ({
        contractId: row.contract_id, projectId: row.project_id, month: row.month,
        range: readRange(row.min_seconds, row.max_seconds), note: row.note,
      })).sort((a, b) => compare(a.month, b.month) || compare(a.contractId, b.contractId) || compareNullable(a.projectId, b.projectId));
    },
    async replaceTimeEntries(period, entries) {
      assertPeriod(period);
      const rows = entries.map((entry) => {
        assertWithinPeriod(entry.date, period);
        integer(entry.seconds);
        if (entry.start !== undefined) assertTimestamp(entry.start);
        if (entry.end !== undefined) assertTimestamp(entry.end);
        return {
          id: entry.id, solidtime_project_id: entry.solidtimeProjectId, date: entry.date,
          seconds: entry.seconds, billable: Number(entry.billable),
          start_at: entry.start ?? null, end_at: entry.end ?? null,
        };
      });
      await db.transaction().execute(async (tx) => {
        await tx.deleteFrom("time_entries").where("date", ">=", period.from).where("date", "<=", period.to).execute();
        for (const batch of batches(rows)) await tx.insertInto("time_entries").values(batch).execute();
      });
    },
    async listDailyWork(period) {
      assertPeriod(period);
      const rows = await db.selectFrom("time_entries as e")
        .innerJoin("projects as p", "p.solidtime_project_id", "e.solidtime_project_id")
        .select(["p.id as projectId", "e.date"])
        .select((eb) => eb.fn.sum<StoredInteger>("e.seconds").as("seconds"))
        .where("e.billable", "=", 1).where("e.date", ">=", period.from).where("e.date", "<=", period.to)
        .groupBy(["p.id", "e.date"]).execute();
      return rows.map((row) => ({ ...row, seconds: integer(row.seconds) }))
        .sort((a, b) => compare(a.projectId, b.projectId) || compare(a.date, b.date));
    },
    async listUnlinkedSolidtimeProjects(period) {
      assertPeriod(period);
      const rows = await db.selectFrom("time_entries as e")
        .leftJoin("projects as p", "p.solidtime_project_id", "e.solidtime_project_id")
        .select("e.solidtime_project_id as solidtimeProjectId")
        .select((eb) => eb.fn.sum<StoredInteger>("e.seconds").as("seconds"))
        .where("p.id", "is", null).where("e.billable", "=", 1)
        .where("e.date", ">=", period.from).where("e.date", "<=", period.to)
        .groupBy("e.solidtime_project_id").execute();
      return rows.map((row) => ({ ...row, seconds: integer(row.seconds) }))
        .sort((a, b) => compareNullable(a.solidtimeProjectId, b.solidtimeProjectId));
    },
    async replaceAbsences(period, absences) {
      assertPeriod(period);
      const rows = Object.entries(absences).map(([date, seconds]) => {
        assertWithinPeriod(date, period);
        return { date, seconds: integer(seconds) };
      });
      await db.transaction().execute(async (tx) => {
        await tx.deleteFrom("absences").where("date", ">=", period.from).where("date", "<=", period.to).execute();
        for (const batch of batches(rows)) await tx.insertInto("absences").values(batch).execute();
      });
    },
    async listAbsences(period) {
      assertPeriod(period);
      const rows = await db.selectFrom("absences").selectAll()
        .where("date", ">=", period.from).where("date", "<=", period.to).execute();
      return Object.fromEntries(rows.sort((a, b) => compare(a.date, b.date)).map((r) => [r.date, integer(r.seconds)]));
    },
    async recordSync(record) {
      assertTimestamp(record.finishedAt);
      await db.insertInto("sync_records").values({
        id: randomUUID(), source: record.source, status: record.status,
        finished_at: record.finishedAt, error: record.error,
      }).execute();
    },
    async getSyncStatus(source) {
      const rows = await db.selectFrom("sync_records").selectAll().where("source", "=", source).execute();
      // Offset-bearing ISO strings must be compared as instants, not as text.
      rows.sort((a, b) => Date.parse(b.finished_at) - Date.parse(a.finished_at) || compare(a.id, b.id));
      const success = rows.find((row) => row.status === "success");
      const failure = rows.find((row) => row.status === "failure");
      return {
        lastSuccessAt: success?.finished_at ?? null,
        lastFailure: failure ? { at: failure.finished_at, error: failure.error } : null,
      } satisfies SyncStatus;
    },
  };
}
