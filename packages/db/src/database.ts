import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect, PostgresDialect, SqliteAdapter, SqliteDialect } from "kysely";
import { Pool } from "pg";
import { openNodeSqlite } from "./node-sqlite.ts";
import type { Schema } from "./schema.ts";

export type Database = Kysely<Schema>;

export type DatabaseOptions =
  | { readonly kind: "sqlite"; readonly filename: string }
  | { readonly kind: "pglite" }
  | { readonly kind: "postgres"; readonly connectionString: string };

class TransactionalSqliteAdapter extends SqliteAdapter {
  override get supportsTransactionalDdl(): boolean {
    // node:sqlite supports rolling back schema changes and migration history together.
    return true;
  }
}

class TransactionalSqliteDialect extends SqliteDialect {
  override createAdapter(): SqliteAdapter {
    return new TransactionalSqliteAdapter();
  }
}

export function createDatabase(options: DatabaseOptions): Database {
  // Lazy creation means destroy() before the first query cannot leak a connection.
  switch (options.kind) {
    case "sqlite":
      return new Kysely<Schema>({
        dialect: new TransactionalSqliteDialect({ database: async () => openNodeSqlite(options.filename) }),
      });
    case "pglite":
      return new Kysely<Schema>({ dialect: new PGliteDialect({ pglite: () => new PGlite() }) });
    case "postgres":
      return new Kysely<Schema>({
        dialect: new PostgresDialect({ pool: async () => new Pool({ connectionString: options.connectionString }) }),
      });
  }
}
