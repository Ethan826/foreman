// The project installs no Bun type package; this declares the parts of
// Bun's built-in `bun:sqlite` that the Runtime layer uses (Bun 1.3.6;
// docs/dependency-intake.md, "bun:sqlite").
declare module "bun:sqlite" {
  /** A value SQLite can bind to a `?` parameter. */
  export type SqlValue = string | number | null

  /** A prepared statement. */
  export interface Statement {
    /** Every result row. */
    all(...params: ReadonlyArray<SqlValue>): ReadonlyArray<unknown>
    /** The first result row, or null. */
    get(...params: ReadonlyArray<SqlValue>): unknown
    /** Runs the statement and discards any rows. */
    run(...params: ReadonlyArray<SqlValue>): void
  }

  /** One connection to a SQLite database file. */
  export class Database {
    /**
     * Opens `filename`. With `create` a missing file is created; with
     * `readonly` it is opened for reading only and never created.
     */
    constructor(filename: string, options?: { readonly create?: boolean; readonly readonly?: boolean })
    /** Runs one or more SQL statements with no parameters. */
    exec(sql: string): void
    /** Prepares (and caches) a statement. */
    query(sql: string): Statement
    /** Closes the connection. */
    close(): void
    /** Whether a transaction is open on this connection. */
    readonly inTransaction: boolean
    /**
     * Calls `sqlite3_file_control` on the main database with operation
     * `op` and the integer `value`; returns SQLite's result code, 0 on
     * success.
     */
    fileControl(op: number, value: number): number
  }

  /** SQLite's numeric constants as Bun exports them. */
  export const constants: {
    /** The file control that keeps the WAL and `-shm` files on close. */
    readonly SQLITE_FCNTL_PERSIST_WAL: number
  }
}
