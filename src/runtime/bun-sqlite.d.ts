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
    constructor(filename: string, options?: { readonly create?: boolean })
    /** Runs one or more SQL statements with no parameters. */
    exec(sql: string): void
    /** Prepares (and caches) a statement. */
    query(sql: string): Statement
    /** Closes the connection. */
    close(): void
    /** Whether a transaction is open on this connection. */
    readonly inTransaction: boolean
  }
}
