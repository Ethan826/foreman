// What the Runtime's SQLite stores share: recognizing a lock timeout and
// reading an error's message without `instanceof` (bun:sqlite throws a
// SQLiteError with a `code` and a `message`).
import { Effect, Exit, Option, Schema } from "effect"

/** SQLite's result code for a lock held past `busy_timeout`. */
const SqliteCodes = { Busy: "SQLITE_BUSY" } as const

/** Whether a thrown error is SQLite's SQLITE_BUSY (a lock held too long). */
export const isSqliteBusy = Schema.is(
  Schema.Struct({ code: Schema.Literal(SqliteCodes.Busy) }),
)

const messageOf = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }))

/** The message of a thrown error, or a fixed text when it has none. */
export const sqliteReason = (error: unknown): string =>
  Option.match(messageOf(error), {
    onNone: () => "unknown SQLite error",
    onSome: ({ message }) => message,
  })

/** The steps of a write transaction on one connection, as effects. */
export interface TxConnection<E> {
  readonly begin: Effect.Effect<void, E>
  readonly commit: Effect.Effect<void, E>
  readonly rollback: Effect.Effect<void, E>
  /** Whether a transaction is still open on the connection. */
  readonly active: Effect.Effect<boolean, E>
}

/** Rolls back if a transaction is still open; reports a failed ROLLBACK. */
const rollbackIfActive = <E>(conn: TxConnection<E>) =>
  Effect.flatMap(conn.active, (active) => (active ? conn.rollback : Effect.void))

/**
 * Runs `body` inside one write transaction and never leaves it open
 * (review finding F1). The bracket is uninterruptible except for `body`
 * itself. If `body` fails or is interrupted, the transaction is rolled
 * back and the body's failure is returned. If COMMIT fails, the
 * transaction is rolled back if still open and the COMMIT failure is
 * returned. A failed ROLLBACK is returned rather than swallowed, since the
 * connection's state is then unknown.
 */
export const transaction = <A, E, EB>(
  conn: TxConnection<E>,
  body: Effect.Effect<A, EB>,
): Effect.Effect<A, E | EB> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* conn.begin
      const outcome = yield* Effect.exit(restore(body))
      if (Exit.isFailure(outcome)) {
        yield* rollbackIfActive(conn)
        return yield* Effect.failCause(outcome.cause)
      }
      const committed = yield* Effect.exit(conn.commit)
      if (Exit.isFailure(committed)) {
        yield* rollbackIfActive(conn)
        return yield* Effect.failCause(committed.cause)
      }
      return outcome.value
    }),
  )

const JournalMode = Schema.Struct({ journal_mode: Schema.String })
const decodeJournalMode = Schema.decodeUnknownOption(JournalMode)

/** The journal mode SQLite's journal-mode pragma reports for WAL. */
const walMode = "wal"

/**
 * Whether a `PRAGMA journal_mode=WAL` result row reports WAL. SQLite keeps
 * another mode silently where WAL cannot apply (an in-memory database, some
 * network filesystems), and the stores rely on WAL.
 */
export const isWal = (row: unknown): boolean =>
  Option.exists(decodeJournalMode(row), (r) => r.journal_mode === walMode)
