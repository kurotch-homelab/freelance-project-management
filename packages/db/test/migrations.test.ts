import { sql } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
