// The shared usage ledger on SQLite (design "Where the ledger lives and
// how instances coordinate"). One database file in WAL mode, one table per
// record kind, and a one-row `ledgerSeq` table. Every write is one
// `BEGIN IMMEDIATE` transaction: SQLite lets one writer hold the lock, so
// each transaction reads the `ledgerSeq` its predecessor committed and seq
// order is commit order across every table. A rolled-back transaction
// leaves no row and no gap. Rows are stored as their Schema encoding in
// JSON; `charges` and `grantCancellations` have a unique key on `grantId`.
import { Database } from "bun:sqlite"
import { Array as Arr, Effect, Option, pipe, Schema } from "effect"
import type { Scope } from "effect"
import type { GrantId } from "../domain/ids.ts"
import { LedgerSeq } from "../domain/ids.ts"
import {
  Allocation,
  Charged,
  Grant,
  GrantCanceled,
  GrantSettled,
  LedgerBusy,
  LedgerError,
  type LedgerEntry,
  LedgerRow,
  type LedgerSnapshot,
  type LedgerStore,
  type LedgerTx,
  PeriodOpened,
  RateUpdated,
  ReadingRow,
  Reserve,
  Retirement,
  SpendDown,
  SpendDownCanceled,
} from "../domain/ledger.ts"

/** The table names (design "Where the ledger lives"). */
const Tables = {
  Grants: "grants",
  Charges: "charges",
  GrantCancellations: "grantCancellations",
  Readings: "readings",
  Periods: "periods",
  Reserves: "reserves",
  Allocations: "allocations",
  SpendDowns: "spendDowns",
  SpendDownCancellations: "spendDownCancellations",
  Retirements: "retirements",
  RateUpdates: "rateUpdates",
} as const
type Table = (typeof Tables)[keyof typeof Tables]

/** Which table holds each row kind, tested with the kind's Schema guard. */
const tableGuards: ReadonlyArray<readonly [(row: LedgerRow) => boolean, Table]> = [
  [Schema.is(Grant), Tables.Grants],
  [Schema.is(Charged), Tables.Charges],
  [Schema.is(GrantCanceled), Tables.GrantCancellations],
  [Schema.is(ReadingRow), Tables.Readings],
  [Schema.is(PeriodOpened), Tables.Periods],
  [Schema.is(Reserve), Tables.Reserves],
  [Schema.is(Allocation), Tables.Allocations],
  [Schema.is(SpendDown), Tables.SpendDowns],
  [Schema.is(SpendDownCanceled), Tables.SpendDownCancellations],
  [Schema.is(Retirement), Tables.Retirements],
  [Schema.is(RateUpdated), Tables.RateUpdates],
]

const tables: ReadonlyArray<Table> = Arr.map(tableGuards, ([, table]) => table)
const settleTables: ReadonlyArray<Table> = [Tables.Charges, Tables.GrantCancellations]

/** The table that holds `row`; every row kind has one. */
const tableFor = (row: LedgerRow) =>
  Effect.fromOption(
    Option.map(
      Arr.findFirst(tableGuards, ([is]) => is(row)),
      ([, table]) => table,
    ),
    () => new LedgerError({ reason: "a row kind with no table" }),
  )

/** SQLite's result code for a lock held past `busy_timeout`. */
const SqliteCodes = { Busy: "SQLITE_BUSY" } as const
const isBusy = Schema.is(Schema.Struct({ code: Schema.Literal(SqliteCodes.Busy) }))
const messageOf = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }))

/** The message of a thrown error, when it has one. */
const reasonOf = (error: unknown): string =>
  Option.match(messageOf(error), {
    onNone: () => "unknown SQLite error",
    onSome: ({ message }) => message,
  })

/** Maps a thrown SQLite error to LedgerBusy (lock held) or LedgerError. */
const toFailure = (error: unknown): LedgerBusy | LedgerError =>
  isBusy(error) ? new LedgerBusy() : new LedgerError({ reason: reasonOf(error) })

/** Runs a synchronous SQLite call, mapping a thrown error. */
const withDb = <A>(use: () => A) => Effect.try({ try: use, catch: toFailure })

/** Turns a lock timeout inside an open transaction into LedgerError. */
const busyAsError = <A, E>(effect: Effect.Effect<A, E | LedgerBusy>) =>
  Effect.catchTag(effect, "LedgerBusy", () =>
    Effect.fail(new LedgerError({ reason: "lock lost inside a transaction" })),
  )

/** Wraps a Schema failure as LedgerError, keeping its message. */
const schemaFailure = (context: string) => (issue: { readonly message: string }) =>
  new LedgerError({ reason: `${context}: ${issue.message}` })

const RowJson = Schema.fromJsonString(LedgerRow)
const encodeRow = (row: LedgerRow) =>
  Effect.mapError(Schema.encodeEffect(RowJson)(row), schemaFailure("encode"))
const decodeRow = (body: unknown) =>
  Effect.mapError(Schema.decodeUnknownEffect(RowJson)(body), schemaFailure("decode"))

const StoredRows = Schema.Array(Schema.Struct({ seq: LedgerSeq, body: Schema.String }))
const decodeStored = (rows: unknown) =>
  Effect.mapError(Schema.decodeUnknownEffect(StoredRows)(rows), schemaFailure("stored rows"))
const LastSeq = Schema.Struct({ last: Schema.Int })
const decodeLast = (row: unknown) =>
  Effect.mapError(Schema.decodeUnknownEffect(LastSeq)(row), schemaFailure("ledgerSeq"))

const tableSql = (table: Table) =>
  `CREATE TABLE IF NOT EXISTS ${table} (seq INTEGER PRIMARY KEY, body TEXT NOT NULL, grantId TEXT)`
const uniqueGrantSql = (table: Table) =>
  `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_grantId ON ${table} (grantId)`

const schemaSql: ReadonlyArray<string> = [
  "PRAGMA journal_mode=WAL",
  "CREATE TABLE IF NOT EXISTS ledgerSeq (id INTEGER PRIMARY KEY CHECK (id = 1), last INTEGER NOT NULL)",
  "INSERT OR IGNORE INTO ledgerSeq (id, last) VALUES (1, 0)",
  ...Arr.map(tables, tableSql),
  ...Arr.map(settleTables, uniqueGrantSql),
]

const unionSql = `${Arr.join(
  Arr.map(tables, (table) => `SELECT seq, body FROM ${table}`),
  " UNION ALL ",
)} ORDER BY seq`

/** The grant a charge or cancel settles, if the row is one. */
const settledGrant = (row: LedgerRow): Option.Option<GrantId> =>
  Schema.is(Charged)(row) || Schema.is(GrantCanceled)(row)
    ? Option.some(row.grantId)
    : Option.none()

/** The table of the other settle kind: a charge's opposite is a cancel. */
const oppositeOf = (table: Table): Table =>
  table === Tables.Charges ? Tables.GrantCancellations : Tables.Charges

const hasGrant = (db: Database, table: Table, grantId: GrantId) =>
  withDb(() => db.query(`SELECT 1 AS found FROM ${table} WHERE grantId = ?`).get(grantId) !== null)

/**
 * Whether to write a settle row: skip it if the grant already has one of
 * the same kind; fail if it has the other kind (a grant is settled once).
 */
const shouldWriteSettle = (db: Database, table: Table, grantId: GrantId) =>
  Effect.gen(function* () {
    if (yield* hasGrant(db, oppositeOf(table), grantId))
      return yield* new GrantSettled({ grantId })
    return !(yield* hasGrant(db, table, grantId))
  })

/** The next seq: one past the last one committed. */
const nextSeq = (db: Database) =>
  Effect.map(
    Effect.flatMap(
      withDb(() => db.query("SELECT last FROM ledgerSeq WHERE id = 1").get()),
      decodeLast,
    ),
    ({ last }) => LedgerSeq.make(last + 1),
  )

/** Inserts `row` at `seq` and records `seq` as the last one used. */
const insertAt = (db: Database, table: Table, row: LedgerRow, seq: LedgerSeq) =>
  Effect.flatMap(encodeRow(row), (body) =>
    withDb(() => {
      db.query(`INSERT INTO ${table} (seq, body, grantId) VALUES (?, ?, ?)`).run(
        seq,
        body,
        Option.getOrNull(settledGrant(row)),
      )
      db.query("UPDATE ledgerSeq SET last = ? WHERE id = 1").run(seq)
    }),
  )

/** Writes one row at the next seq, or skips a repeated charge or cancel. */
const appendOne = (db: Database) => (row: LedgerRow) =>
  Effect.gen(function* () {
    const table = yield* tableFor(row)
    const grant = settledGrant(row)
    const write = Option.isSome(grant)
      ? yield* shouldWriteSettle(db, table, grant.value)
      : true
    if (!write) return Option.none<LedgerSeq>()
    const seq = yield* nextSeq(db)
    yield* insertAt(db, table, row, seq)
    return Option.some(seq)
  })

/** Every stored row, in seq order. */
const readAll = (db: Database): Effect.Effect<LedgerSnapshot, LedgerError | LedgerBusy> =>
  Effect.gen(function* () {
    const stored = yield* Effect.flatMap(
      withDb(() => db.query(unionSql).all()),
      decodeStored,
    )
    const entries = yield* Effect.forEach(stored, ({ seq, body }) =>
      Effect.map(decodeRow(body), (row): LedgerEntry => ({ seq, row })),
    )
    return { entries }
  })

const txOf = (db: Database): LedgerTx => ({
  read: busyAsError(readAll(db)),
  append: (rows) =>
    pipe(Effect.forEach(rows, appendOne(db)), busyAsError, Effect.map(Arr.getSomes)),
})

const rollback = (db: Database) =>
  Effect.ignore(
    withDb(() => {
      db.exec("ROLLBACK")
    }),
  )

const storeOf = (db: Database): LedgerStore => ({
  transact: (body) =>
    Effect.gen(function* () {
      yield* withDb(() => {
        db.exec("BEGIN IMMEDIATE")
      })
      const result = yield* Effect.onError(body(txOf(db)), () => rollback(db))
      yield* withDb(() => {
        db.exec("COMMIT")
      })
      return result
    }),
})

/** Opens the database, sets `busy_timeout` and creates any missing table. */
const open = (path: string, busyTimeoutMillis: number) =>
  withDb(() => {
    const db = new Database(path, { create: true })
    db.exec(`PRAGMA busy_timeout=${String(busyTimeoutMillis)}`)
    Arr.forEach(schemaSql, (sql) => {
      db.exec(sql)
    })
    return db
  })

/**
 * Opens (creating if needed) the ledger at `path` for the scope, in WAL mode
 * with `busy_timeout` set to `busyTimeoutMillis`, and closes it when the
 * scope ends. A write that waits for the lock longer than that fails with
 * {@link LedgerBusy} and writes nothing.
 */
export const openLedger = (
  path: string,
  busyTimeoutMillis: number,
): Effect.Effect<LedgerStore, LedgerError | LedgerBusy, Scope.Scope> =>
  Effect.map(
    Effect.acquireRelease(open(path, busyTimeoutMillis), (db) =>
      Effect.sync(() => {
        db.close()
      }),
    ),
    storeOf,
  )
