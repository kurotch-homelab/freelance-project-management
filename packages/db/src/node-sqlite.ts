import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type { SqliteDatabase } from "kysely";

function parametersFor(values: readonly unknown[]): SQLInputValue[] {
  return values.map((value) => {
    if (
      value === null || typeof value === "string" || typeof value === "number" ||
      typeof value === "bigint"
    ) {
      return value;
    }
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError("Unsupported SQLite parameter");
  });
}

/** The small synchronous interface required by Kysely's SqliteDialect. */
export function openNodeSqlite(filename: string): SqliteDatabase {
  const database = new DatabaseSync(filename);
  try {
    database.exec("PRAGMA foreign_keys = ON");
    database.exec("PRAGMA busy_timeout = 5000");
  } catch (error) {
    database.close();
    throw error;
  }
  return {
    close: () => database.close(),
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        // Includes SELECT, PRAGMA and INSERT/UPDATE/DELETE ... RETURNING.
        reader: statement.columns().length > 0,
        all: (parameters) => statement.all(...parametersFor(parameters)),
        run: (parameters) => statement.run(...parametersFor(parameters)),
        iterate: (parameters) => statement.iterate(...parametersFor(parameters)),
      };
    },
  };
}
