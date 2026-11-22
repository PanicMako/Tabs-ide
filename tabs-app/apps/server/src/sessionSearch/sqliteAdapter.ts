// Minimal runtime-agnostic SQLite handle (node:sqlite, or bun:sqlite under Bun). Used inside
// the session-search worker thread only, so synchronous calls never touch the server loop.
export interface SqlStatement {
  run: (...params: ReadonlyArray<unknown>) => unknown;
  get: (...params: ReadonlyArray<unknown>) => unknown;
  all: (...params: ReadonlyArray<unknown>) => ReadonlyArray<unknown>;
}

export interface SqlDatabase {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqlStatement;
  close: () => void;
}

export async function openSqlDatabase(
  path: string,
  options: { readonly readOnly?: boolean } = {},
): Promise<SqlDatabase> {
  if (process.versions.bun !== undefined) {
    const specifier = "bun:sqlite";
    const { Database } = (await import(/* @vite-ignore */ specifier)) as {
      Database: new (
        file: string,
        opts: { readonly?: boolean },
      ) => {
        exec: (sql: string) => void;
        query: (sql: string) => SqlStatement;
        close: () => void;
      };
    };
    const database = new Database(path, options.readOnly ? { readonly: true } : {});
    return {
      exec: (sql) => database.exec(sql),
      prepare: (sql) => database.query(sql),
      close: () => database.close(),
    };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(path, { readOnly: options.readOnly === true });
  return {
    exec: (sql) => database.exec(sql),
    prepare: (sql) => database.prepare(sql) as unknown as SqlStatement,
    close: () => database.close(),
  };
}
