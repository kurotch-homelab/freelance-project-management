import { PGlite } from "@electric-sql/pglite";
import { Kysely, PGliteDialect, PostgresDialect, SqliteDialect } from "kysely";
import { Pool } from "pg";
import { openNodeSqlite } from "./node-sqlite.ts";
import type { Schema } from "./schema.ts";

export type Database = Kysely<Schema>;

export type DatabaseOptions =
  | { readonly kind: "sqlite"; readonly filename: string }
  | { readonly kind: "pglite" }
  | { readonly kind: "postgres"; readonly connectionString: string };

export function createDatabase(options: DatabaseOptions): Database {
  // Lazy creation means destroy() before the first query cannot leak a connection.
  switch (options.kind) {
    case "sqlite":
      return new Kysely<Schema>({
        dialect: new SqliteDialect({ database: async () => openNodeSqlite(options.filename) }),
      });
    case "pglite":
      return new Kysely<Schema>({ dialect: new PGliteDialect({ pglite: () => new PGlite() }) });
    case "postgres":
      return new Kysely<Schema>({
        dialect: new PostgresDialect({ pool: async () => new Pool({ connectionString: options.connectionString }) }),
      });
  }
}
