import { sql } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrationProvider } from "../src/migrations.ts";
import { createDatabase, migrateToLatest, type Database } from "../src/index.ts";

const backends = [
  ["sqlite", () => createDatabase({ kind: "sqlite", filename: ":memory:" })],
  ["postgres (PGlite)", () => createDatabase({ kind: "pglite" })],
] as const;

describe.each(backends)("マイグレーションのトランザクション (%s)", (_name, open) => {
  let db: Database;

  beforeEach(() => {
    db = open();
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("001 の旧テーブルから 002 に移行し、旧データをリセットして同期記録と不在は保持する", async () => {
    const migrator = new Migrator({ db, provider: migrationProvider });
    const result = await migrator.migrateTo("001_initial_schema");
    expect(result.error).toBeUndefined();
    await sql`insert into clients (id, name, closing_day, payment_month_offset, payment_day, subject_template, line_grouping)
      values ('local-client', 'A', 'end', 1, 'end', 'template', 'project')`.execute(db);
    await sql`insert into projects (id, client_id, name, status, solidtime_project_id)
      values ('local-project', 'local-client', 'X', 'active', 'st-project')`.execute(db);
    await sql`insert into contracts (id, client_id, name, start_date, hourly_rate, has_hours_range, has_project_hours_ranges, renewal_outlook)
      values ('c', 'local-client', 'C', '2026-01-01', 5000, 0, 0, 'undecided')`.execute(db);
    await sql`insert into contract_projects (contract_id, project_id, position, has_hours_range) values ('c', 'local-project', 0, 0)`.execute(db);
    await sql`insert into hours_range_overrides (id, contract_id, project_id, month, note, recorded_at)
      values ('o', 'c', 'local-project', '2026-11', '', '2026-11-01T00:00:00Z')`.execute(db);
    await sql`insert into time_entries (id, solidtime_project_id, date, seconds, billable) values ('e', 'st-project', '2026-11-01', 3600, 1)`.execute(db);
    await sql`insert into absences (date, seconds) values ('2026-11-01', 3600)`.execute(db);
    await sql`insert into sync_records (id, source, status, finished_at) values ('s', 'calendar', 'success', '2026-11-01T00:00:00Z')`.execute(db);
    await migrateToLatest(db);
    await migrateToLatest(db);
    const tables = await db.introspection.getTables();
    expect(tables.find((t) => t.name === "clients")?.columns.map((c) => c.name)).not.toContain("solidtime_client_id");
    const projectColumns = tables.find((t) => t.name === "projects")!.columns.map((c) => c.name);
    expect(projectColumns).toContain("hourly_rate");
    expect(projectColumns).toContain("archived");
    expect(projectColumns).not.toContain("solidtime_project_id");
    expect(projectColumns).not.toContain("status");
    for (const table of ["contracts", "contract_projects"] as const) {
      expect(tables.find((t) => t.name === table)?.columns.map((c) => c.name)).not.toContain("hourly_rate");
    }
    for (const table of ["clients", "projects", "contracts", "contract_projects", "hours_range_overrides", "time_entries"] as const) {
      expect(await db.selectFrom(table).selectAll().execute()).toEqual([]);
    }
    expect(await db.selectFrom("absences").selectAll().execute()).toHaveLength(1);
    expect(await db.selectFrom("sync_records").selectAll().execute()).toHaveLength(1);
  });

  it("002 から 003 は既存データを残し、打刻の単価は再同期まで null にする", async () => {
    const migrator = new Migrator({ db, provider: migrationProvider });
    expect((await migrator.migrateTo("002_solidtime_source")).error).toBeUndefined();
    await sql`insert into clients (id, name, closing_day, payment_month_offset, payment_day, subject_template, line_grouping, archived)
      values ('a', 'A', 'end', 1, 'end', 'template', 'project', 0)`.execute(db);
    await sql`insert into projects (id, client_id, name, archived, hourly_rate) values ('x', 'a', 'X', 0, 5000)`.execute(db);
    await sql`insert into time_entries (id, solidtime_project_id, date, seconds, billable, start_at)
      values ('e', 'x', '2026-11-01', 3600, 1, '2026-11-01T00:00:00Z')`.execute(db);
    expect((await migrator.migrateTo("003_time_entry_rates")).error).toBeUndefined();
    expect((await migrator.migrateTo("003_time_entry_rates")).error).toBeUndefined();
    expect(await db.selectFrom("time_entries").select(["id", "hourly_rate", "start_at"]).execute())
      .toEqual([{ id: "e", hourly_rate: null, start_at: "2026-11-01T00:00:00Z" }]);
    expect(await db.selectFrom("projects").select(["id", "hourly_rate"]).execute())
      .toEqual([{ id: "x", hourly_rate: 5000 }]);
    await db.updateTable("time_entries").set({ hourly_rate: 6000.25 }).execute();
    expect((await db.selectFrom("time_entries").select("hourly_rate").executeTakeFirst())?.hourly_rate).toBe(6000.25);
    await expect(db.updateTable("time_entries").set({ hourly_rate: -1 }).execute()).rejects.toThrow();
    expect((await migrator.migrateDown()).error).toBeUndefined();
    expect((await migrator.migrateTo("003_time_entry_rates")).error).toBeUndefined();
    expect(await db.selectFrom("time_entries").select(["id", "hourly_rate"]).execute()).toEqual([{ id: "e", hourly_rate: null }]);
  });

  it("003 のあとに 004 を適用し、打刻と請求単価を残したまま user_id を追加する", async () => {
    const migrator = new Migrator({ db, provider: migrationProvider });
    expect((await migrator.migrateTo("003_time_entry_rates")).error).toBeUndefined();
    await sql`insert into time_entries (id, solidtime_project_id, date, seconds, billable, start_at, hourly_rate)
      values ('e', 'x', '2026-08-01', 3600, 1, '2026-08-01T00:00:00Z', 5000.25)`.execute(db);
    await migrateToLatest(db);
    await migrateToLatest(db);
    const saved = await db.selectFrom("time_entries").selectAll().executeTakeFirstOrThrow();
    expect(saved).toMatchObject({ id: "e", user_id: null, hourly_rate: 5000.25, start_at: "2026-08-01T00:00:00Z" });
    await db.updateTable("time_entries").set({ user_id: "company-user" }).execute();
    expect((await db.selectFrom("time_entries").select("user_id").executeTakeFirst())?.user_id).toBe("company-user");
    expect((await migrator.migrateDown()).error).toBeUndefined();
    expect((await db.introspection.getTables()).find((table) => table.name === "time_entries")?.columns.map((c) => c.name))
      .not.toContain("user_id");
    await migrateToLatest(db);
    expect(await db.selectFrom("time_entries").selectAll().executeTakeFirst()).toEqual(saved);
  });

  it.each(["exception", "sql"] as const)("途中の %s エラーはその 1 件だけを戻し、修正後に再実行できる", async (failure) => {
    let shouldFail = true;
    const migrations: Record<string, Migration> = {
      "001_committed": {
        async up(tx) {
          await tx.schema.createTable("committed").addColumn("value", "integer").execute();
          await sql`insert into committed (value) values (1)`.execute(tx);
        },
      },
      "002_retryable": {
        async up(tx) {
          await tx.schema.createTable("retryable").addColumn("id", "integer", (c) => c.primaryKey()).execute();
          await sql`insert into retryable (id) values (1)`.execute(tx);
          await sql`update committed set value = 2`.execute(tx);
          if (shouldFail) {
            if (failure === "sql") await sql`insert into retryable (id) values (1)`.execute(tx);
            throw new Error("migration failed");
          }
        },
      },
      "003_later": {
        async up(tx) {
          await tx.schema.createTable("later").addColumn("id", "integer").execute();
        },
      },
    };
    const provider: MigrationProvider = { getMigrations: async () => migrations };

    await expect(migrateToLatest(db, provider)).rejects.toThrow();
    const tables = (await db.introspection.getTables()).map((table) => table.name);
    expect(tables).toContain("committed");
    expect(tables).not.toContain("retryable");
    expect(tables).not.toContain("later");
    expect((await sql<{ value: number }>`select value from committed`.execute(db)).rows).toEqual([{ value: 1 }]);
    expect((await sql<{ name: string }>`select name from kysely_migration order by name`.execute(db)).rows)
      .toEqual([{ name: "001_committed" }]);

    shouldFail = false;
    await migrateToLatest(db, provider);
    await expect(migrateToLatest(db, provider)).resolves.toBeUndefined();
    expect((await sql<{ value: number }>`select value from committed`.execute(db)).rows).toEqual([{ value: 2 }]);
    expect((await sql<{ id: number }>`select id from retryable`.execute(db)).rows).toEqual([{ id: 1 }]);
    expect((await db.introspection.getTables()).map((table) => table.name)).toContain("later");
    expect((await sql<{ name: string }>`select name from kysely_migration order by name`.execute(db)).rows)
      .toEqual(Object.keys(migrations).map((name) => ({ name })));
  });

  it("適用履歴の書き込みが失敗しても、スキーマと履歴の両方を戻す", async () => {
    const provider: MigrationProvider = {
      async getMigrations() {
        return {
          "001_history_conflict": {
            async up(tx) {
              await tx.schema.createTable("uncommitted").addColumn("id", "integer").execute();
              // Force the Migrator's subsequent history insert to fail its primary key constraint.
              await sql`insert into kysely_migration (name, timestamp)
                values ('001_history_conflict', '2026-11-05T00:00:00.000Z')`.execute(tx);
            },
          },
        };
      },
    };

    await expect(migrateToLatest(db, provider)).rejects.toThrow();
    expect((await db.introspection.getTables()).map((table) => table.name)).not.toContain("uncommitted");
    expect((await sql`select name from kysely_migration`.execute(db)).rows).toEqual([]);
  });
});
