// The shared usage ledger on SQLite (design "Where the ledger lives and
// how instances coordinate"). One database file in WAL mode, one table per
// record kind, and a one-row `ledgerSeq` table. Every write is one
// `BEGIN IMMEDIATE` transaction: SQLite lets one writer hold the lock, so
// each transaction reads the `ledgerSeq` its predecessor committed and seq
// order is commit order across every table. A rolled-back transaction
// leaves no row and no gap. Rows are stored as their Schema encoding in
// JSON; `charges` and `grantCancellations` have a unique key on `grantId`.
// The file's format version is SQLite's `user_version` header field
// (dogfood-5): `open` reads it before it opens the file for writing, and
// again inside the `BEGIN IMMEDIATE` transaction that creates the tables
// and stamps a ledger at 0 with 1; a ledger stamped newer than
// `knownLedgerVersion` (1), or below 0, is refused and left untouched
// (`openWriter` in `sqlite.ts`). The ledger is never raised.
//
// Domain's busy-wait contract (`LedgerStore`: a write that meets another
// writer's lock waits up to the configured busy timeout, then fails with
// `LedgerBusy` and writes nothing) is met by setting
// `PRAGMA busy_timeout` to the configured value on every connection the
// open makes, the read-only version check and the writer alike. SQLite
// documents that behaviour: a statement that finds a table locked sleeps
// and retries until at least that many milliseconds have passed, then
// returns SQLITE_BUSY (sqlite.org/pragma.html#pragma_busy_timeout,
// sqlite.org/c3ref/busy_timeout.html). Every write's `BEGIN IMMEDIATE`
// takes the write lock first, so that is where SQLITE_BUSY meets a write;
// this module maps it to `LedgerBusy`, and the transaction has written
// nothing (a busy error after the lock is taken is `LedgerError`, "lock
// lost inside a transaction", and rolls back). That documented
// behaviour is the evidence; no test observes the wait, since `bun:sqlite`
// offers no way to see that a write met the lock. The tests check that
// the connection the production open makes carries the configured value
// (read with `busyTimeoutOf` through `openLedgerWith`) and
// that a write under a held lock fails with `LedgerBusy` and writes
// nothing. Another database would supply its own evidence against the
// Domain contract (dogfood-6f, owner ruling of 2026-11-28).
import type { Database } from "bun:sqlite"
import { Array as Arr, Effect, Option, pipe, Schema, Semaphore } from "effect"
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
import { knownLedgerVersion, type StoreVersionNewer } from "../domain/store-version.ts"
import {
  type ConnectSqlite,
  connectSqlite,
  isSqliteBusy,
  openWriter,
  sqliteReason,
  transaction,
  type TxConnection,
} from "./sqlite.ts"

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

/** Maps a thrown SQLite error to LedgerBusy (lock held) or LedgerError. */
const toFailure = (error: unknown): LedgerBusy | LedgerError =>
  isSqliteBusy(error) ? new LedgerBusy() : new LedgerError({ reason: sqliteReason(error) })

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

/** Every stored row, in seq order, in one statement on `db`; a status read uses it too. */
export const readAll = (db: Database): Effect.Effect<LedgerSnapshot, LedgerError | LedgerBusy> =>
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

/** The connection's transaction steps, with SQLite errors mapped. */
const connectionOf = (db: Database): TxConnection<LedgerBusy | LedgerError> => ({
  begin: withDb(() => {
    db.exec("BEGIN IMMEDIATE")
  }),
  commit: withDb(() => {
    db.exec("COMMIT")
  }),
  rollback: withDb(() => {
    db.exec("ROLLBACK")
  }),
  active: withDb(() => db.inTransaction),
})

/**
 * The store over one connection. A connection holds one transaction at a
 * time, so `transact` calls on the same store queue on a one-permit
 * semaphore instead of failing with "cannot start a transaction within a
 * transaction" when their bodies overlap.
 */
const storeOf = (db: Database, lock: Semaphore.Semaphore): LedgerStore => ({
  transact: (body) => Semaphore.withPermits(lock, 1)(transaction(connectionOf(db), body(txOf(db)))),
})

/**
 * Opens the ledger's writer connection in the order of ruling P1
 * (`openWriter` in `sqlite.ts`) with the ledger's error mapping: a lock
 * timeout is {@link LedgerBusy}, a refused journal mode or a negative
 * format version is {@link LedgerError}, and a newer version is
 * `StoreVersionNewer`.
 */
const open = (connect: ConnectSqlite, path: string, busyTimeoutMillis: number) =>
  openWriter<LedgerBusy | LedgerError>({
    path,
    connect,
    knownVersion: knownLedgerVersion,
    busyTimeoutMillis,
    schemaSql,
    failure: toFailure,
    refused: (reason) => new LedgerError({ reason }),
    connection: connectionOf,
  })

/**
 * {@link openLedger} with its read-write connection made by `connect`
 * (`ConnectSqlite` in `sqlite.ts`) instead of the production
 * `connectSqlite`; everything else, `busy_timeout` included, is set by the
 * open as in {@link openLedger}. Production uses {@link openLedger}; a test
 * passes a `connect` that records the connection, to read its busy timeout
 * after the open (dogfood-6f, owner ruling of 2026-11-28).
 */
export const openLedgerWith =
  (connect: ConnectSqlite) =>
  (
    path: string,
    busyTimeoutMillis: number,
  ): Effect.Effect<LedgerStore, LedgerError | LedgerBusy | StoreVersionNewer, Scope.Scope> =>
    Effect.map(
      Effect.acquireRelease(open(connect, path, busyTimeoutMillis), (db) =>
        Effect.sync(() => {
          db.close()
        }),
      ),
      (db) => storeOf(db, Semaphore.makeUnsafe(1)),
    )

/**
 * Opens (creating if needed) the ledger at `path` for the scope, in WAL mode
 * with `busy_timeout` set to `busyTimeoutMillis` on every connection it
 * makes, and closes it when the scope ends. That is how it meets Domain's
 * busy-wait contract ({@link LedgerStore}): a write that meets another
 * writer's lock waits up to `busyTimeoutMillis`, as SQLite documents for
 * `busy_timeout` (sqlite.org/pragma.html#pragma_busy_timeout,
 * sqlite.org/c3ref/busy_timeout.html), and then fails with
 * {@link LedgerBusy} and writes nothing. SQLite's documented behaviour is
 * the evidence for the wait; no test observes it. The open itself takes
 * the write lock briefly, so it can wait as long and fail with
 * {@link LedgerBusy} too. A ledger at
 * format version 0 (written by v0.1.0) is stamped 1 and a new one is
 * created at 1. A ledger stamped by a newer release fails with
 * `StoreVersionNewer`, and one stamped below 0 with {@link LedgerError};
 * either is left as it was, read and written by nothing.
 */
export const openLedger: (
  path: string,
  busyTimeoutMillis: number,
) => Effect.Effect<LedgerStore, LedgerError | LedgerBusy | StoreVersionNewer, Scope.Scope> =
  openLedgerWith(connectSqlite)
