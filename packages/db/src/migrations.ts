import { sql } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import type { Database } from "./database.ts";

const initialSchema: Migration = {
  async up(db) {
    await db.schema.createTable("clients")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("closing_day", "text", (c) => c.notNull())
      .addColumn("payment_month_offset", "integer", (c) => c.notNull())
      .addColumn("payment_day", "text", (c) => c.notNull())
      .addColumn("subject_template", "text", (c) => c.notNull())
      .addColumn("line_grouping", "text", (c) => c.notNull())
      .addColumn("solidtime_client_id", "text")
      .addColumn("drive_folder_id", "text")
      .execute();

    await db.schema.createTable("projects")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("client_id", "text", (c) => c.notNull().references("clients.id"))
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("solidtime_project_id", "text", (c) => c.unique())
      .addColumn("drive_folder_id", "text")
      .execute();

    await db.schema.createTable("contracts")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("client_id", "text", (c) => c.notNull().references("clients.id"))
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("start_date", "text", (c) => c.notNull())
      .addColumn("end_date", "text")
      .addColumn("hourly_rate", "bigint", (c) => c.notNull().check(sql`hourly_rate >= 0`))
      .addColumn("min_seconds", "bigint", (c) => c.check(sql`min_seconds >= 0`))
      .addColumn("max_seconds", "bigint", (c) => c.check(sql`max_seconds >= 0`))
      .addColumn("has_hours_range", "integer", (c) => c.notNull())
      .addColumn("has_project_hours_ranges", "integer", (c) => c.notNull())
      .addColumn("renewal_outlook", "text", (c) => c.notNull())
      .execute();

    await db.schema.createTable("contract_projects")
      .addColumn("contract_id", "text", (c) => c.notNull().references("contracts.id").onDelete("cascade"))
      .addColumn("project_id", "text", (c) => c.notNull().references("projects.id"))
      .addColumn("position", "integer", (c) => c.notNull())
      .addColumn("hourly_rate", "bigint", (c) => c.check(sql`hourly_rate >= 0`))
      .addColumn("min_seconds", "bigint", (c) => c.check(sql`min_seconds >= 0`))
      .addColumn("max_seconds", "bigint", (c) => c.check(sql`max_seconds >= 0`))
      .addColumn("has_hours_range", "integer", (c) => c.notNull())
      .addPrimaryKeyConstraint("contract_projects_pk", ["contract_id", "project_id"])
      .execute();

    await db.schema.createTable("hours_range_overrides")
      // A nullable project_id cannot participate in a portable unique key.
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("contract_id", "text", (c) => c.notNull().references("contracts.id").onDelete("cascade"))
      .addColumn("project_id", "text", (c) => c.references("projects.id"))
      .addColumn("month", "text", (c) => c.notNull())
      .addColumn("min_seconds", "bigint", (c) => c.check(sql`min_seconds >= 0`))
      .addColumn("max_seconds", "bigint", (c) => c.check(sql`max_seconds >= 0`))
      .addColumn("note", "text", (c) => c.notNull())
      .addColumn("recorded_at", "text", (c) => c.notNull())
      .execute();

    await db.schema.createTable("time_entries")
      .addColumn("id", "text", (c) => c.primaryKey())
      // Keep entries even when their external project is not linked yet.
      .addColumn("solidtime_project_id", "text")
      .addColumn("date", "text", (c) => c.notNull())
      .addColumn("seconds", "bigint", (c) => c.notNull().check(sql`seconds >= 0`))
      .addColumn("billable", "integer", (c) => c.notNull().check(sql`billable in (0, 1)`))
      .addColumn("start_at", "text")
      .addColumn("end_at", "text")
      .execute();

    await db.schema.createTable("absences")
      .addColumn("date", "text", (c) => c.primaryKey())
      .addColumn("seconds", "bigint", (c) => c.notNull().check(sql`seconds >= 0`))
      .execute();

    await db.schema.createTable("sync_records")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("source", "text", (c) => c.notNull())
      .addColumn("status", "text", (c) => c.notNull())
      .addColumn("finished_at", "text", (c) => c.notNull())
      .addColumn("error", "text")
      .execute();

    await db.schema.createIndex("projects_client_idx").on("projects").column("client_id").execute();
    await db.schema.createIndex("contracts_client_idx").on("contracts").column("client_id").execute();
    await db.schema.createIndex("contract_projects_project_idx").on("contract_projects").column("project_id").execute();
    await db.schema.createIndex("hours_range_overrides_month_idx").on("hours_range_overrides").column("month").execute();
    await db.schema.createIndex("time_entries_date_idx").on("time_entries").column("date").execute();
    await db.schema.createIndex("sync_records_source_idx").on("sync_records").column("source").execute();
  },
  async down(db) {
    for (const table of [
      "sync_records", "absences", "time_entries", "hours_range_overrides",
      "contract_projects", "contracts", "projects", "clients",
    ]) {
      await db.schema.dropTable(table).execute();
    }
  },
};

// Pre-production reset: old local IDs and contract rates cannot be mapped reliably.
// Drop dependents first so the same migration works with FK checks in both engines.
const solidtimeSourceSchema: Migration = {
  async up(db) {
    for (const table of ["time_entries", "hours_range_overrides", "contract_projects", "contracts", "projects", "clients"]) {
      await db.schema.dropTable(table).execute();
    }
    await db.schema.createTable("clients")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("closing_day", "text", (c) => c.notNull())
      .addColumn("payment_month_offset", "integer", (c) => c.notNull())
      .addColumn("payment_day", "text", (c) => c.notNull())
      .addColumn("subject_template", "text", (c) => c.notNull())
      .addColumn("line_grouping", "text", (c) => c.notNull())
      .addColumn("archived", "integer", (c) => c.notNull().check(sql`archived in (0, 1)`))
      .addColumn("drive_folder_id", "text")
      .execute();

    await db.schema.createTable("projects")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("client_id", "text", (c) => c.references("clients.id"))
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("archived", "integer", (c) => c.notNull().check(sql`archived in (0, 1)`))
      .addColumn("hourly_rate", "double precision", (c) => c.check(sql`hourly_rate >= 0`))
      .addColumn("drive_folder_id", "text")
      .execute();

    await db.schema.createTable("contracts")
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("client_id", "text", (c) => c.notNull().references("clients.id"))
      .addColumn("name", "text", (c) => c.notNull())
      .addColumn("start_date", "text", (c) => c.notNull())
      .addColumn("end_date", "text")
      .addColumn("min_seconds", "bigint", (c) => c.check(sql`min_seconds >= 0`))
      .addColumn("max_seconds", "bigint", (c) => c.check(sql`max_seconds >= 0`))
      .addColumn("has_hours_range", "integer", (c) => c.notNull())
      .addColumn("has_project_hours_ranges", "integer", (c) => c.notNull())
      .addColumn("renewal_outlook", "text", (c) => c.notNull())
      .execute();

    await db.schema.createTable("contract_projects")
      .addColumn("contract_id", "text", (c) => c.notNull().references("contracts.id").onDelete("cascade"))
      .addColumn("project_id", "text", (c) => c.notNull().references("projects.id"))
      .addColumn("position", "integer", (c) => c.notNull())
      .addColumn("min_seconds", "bigint", (c) => c.check(sql`min_seconds >= 0`))
      .addColumn("max_seconds", "bigint", (c) => c.check(sql`max_seconds >= 0`))
      .addColumn("has_hours_range", "integer", (c) => c.notNull())
      .addPrimaryKeyConstraint("contract_projects_pk", ["contract_id", "project_id"])
      .execute();

    await db.schema.createTable("hours_range_overrides")
      // A nullable project_id cannot participate in a portable unique key.
      .addColumn("id", "text", (c) => c.primaryKey())
      .addColumn("contract_id", "text", (c) => c.notNull().references("contracts.id").onDelete("cascade"))
      .addColumn("project_id", "text", (c) => c.references("projects.id"))
      .addColumn("month", "text", (c) => c.notNull())
      .addColumn("min_seconds", "bigint", (c) => c.check(sql`min_seconds >= 0`))
      .addColumn("max_seconds", "bigint", (c) => c.check(sql`max_seconds >= 0`))
      .addColumn("note", "text", (c) => c.notNull())
      .addColumn("recorded_at", "text", (c) => c.notNull())
      .execute();

    await db.schema.createTable("time_entries")
      .addColumn("id", "text", (c) => c.primaryKey())
      // Keep entries even when their external project is not linked yet.
      .addColumn("solidtime_project_id", "text")
      .addColumn("date", "text", (c) => c.notNull())
      .addColumn("seconds", "bigint", (c) => c.notNull().check(sql`seconds >= 0`))
      .addColumn("billable", "integer", (c) => c.notNull().check(sql`billable in (0, 1)`))
      .addColumn("start_at", "text")
      .addColumn("end_at", "text")
      .execute();

    await db.schema.createIndex("projects_client_idx").on("projects").column("client_id").execute();
    await db.schema.createIndex("contracts_client_idx").on("contracts").column("client_id").execute();
    await db.schema.createIndex("contract_projects_project_idx").on("contract_projects").column("project_id").execute();
    await db.schema.createIndex("hours_range_overrides_month_idx").on("hours_range_overrides").column("month").execute();
    await db.schema.createIndex("time_entries_date_idx").on("time_entries").column("date").execute();
  },
};

const timeEntryRates: Migration = {
  async up(db) {
    // Existing entries have no user-specific rate; the next sync fills it in.
    await db.schema.alterTable("time_entries")
      .addColumn("hourly_rate", "double precision", (c) => c.check(sql`hourly_rate >= 0`))
      .execute();
  },
  async down(db) {
    await db.schema.alterTable("time_entries").dropColumn("hourly_rate").execute();
  },
};

const timeEntryUsers: Migration = {
  async up(db) {
    // Old entries keep their billing rates; user IDs are filled by the next sync.
    await db.schema.alterTable("time_entries").addColumn("user_id", "text").execute();
  },
  async down(db) {
    await db.schema.alterTable("time_entries").dropColumn("user_id").execute();
  },
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return { "001_initial_schema": initialSchema, "002_solidtime_source": solidtimeSourceSchema, "003_time_entry_rates": timeEntryRates, "004_time_entry_users": timeEntryUsers };
  },
};

/** migrationProvider は失敗時のロールバック検証に使う内部用の差し替え口。 */
export async function migrateToLatest(db: Database, provider: MigrationProvider = migrationProvider): Promise<void> {
  const migrator = new Migrator({ db, provider });
  // Commit each migration and its history entry together. Earlier successful
  // migrations remain applied if a later one fails, on both SQLite and PostgreSQL.
  while (true) {
    const { error, results } = await migrator.migrateUp();
    if (error !== undefined) throw error;
    if (results?.length === 0) return;
  }
}
