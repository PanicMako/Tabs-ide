interface StatementLike<Row, Params extends ReadonlyArray<unknown> = ReadonlyArray<unknown>> {
  readonly run: (...params: Params) => unknown;
  readonly get: (...params: Params) => Row | undefined;
  readonly all: (...params: Params) => ReadonlyArray<Row>;
}

interface NativeDatabase {
  readonly exec: (sql: string) => unknown;
  readonly close: () => void;
  readonly query?: (sql: string) => StatementLike<unknown>;
  readonly prepare?: (sql: string) => StatementLike<unknown>;
  readonly transaction?: (callback: () => void) => () => void;
}

type NativeDatabaseConstructor = new (
  path: string,
  options?: Record<string, unknown>,
) => NativeDatabase;

// The server supports both its Bun development runtime and its Node production
// runtime. Keeping the module specifier dynamic prevents either runtime from
// resolving the other runtime's built-in SQLite module during startup.
const sqliteModuleName = process.versions.bun ? "bun:sqlite" : "node:sqlite";
const require = createRequire(import.meta.url);
const sqliteModule = require(sqliteModuleName) as {
  readonly Database?: NativeDatabaseConstructor;
  readonly DatabaseSync?: NativeDatabaseConstructor;
};
const databaseConstructor = sqliteModule.Database ?? sqliteModule.DatabaseSync;
if (!databaseConstructor) {
  throw new Error(`No SQLite database constructor in ${sqliteModuleName}`);
}
const DatabaseConstructor: NativeDatabaseConstructor = databaseConstructor;

export class RuntimeSqliteDatabase {
  readonly #native: NativeDatabase;

  constructor(path: string, options: { readonly?: boolean } = {}) {
    this.#native = process.versions.bun
      ? new DatabaseConstructor(path, {
          create: !options.readonly,
          strict: true,
          readonly: options.readonly,
        })
      : new DatabaseConstructor(path, { readOnly: options.readonly });
  }

  exec(sql: string): void {
    this.#native.exec(sql);
  }

  query<Row, Params extends ReadonlyArray<unknown> = ReadonlyArray<unknown>>(
    sql: string,
  ): StatementLike<Row, Params> {
    const statement = this.#native.query?.(sql) ?? this.#native.prepare?.(sql);
    if (!statement) throw new Error("SQLite runtime does not provide query or prepare");
    return statement as StatementLike<Row, Params>;
  }

  transaction(callback: () => void): () => void {
    if (this.#native.transaction) return this.#native.transaction(callback);
    return () => {
      this.#native.exec("BEGIN IMMEDIATE");
      try {
        callback();
        this.#native.exec("COMMIT");
      } catch (error) {
        this.#native.exec("ROLLBACK");
        throw error;
      }
    };
  }

  close(): void {
    this.#native.close();
  }
}
import { createRequire } from "node:module";
