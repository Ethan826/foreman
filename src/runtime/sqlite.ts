// What the Runtime's SQLite stores share: recognizing a lock timeout and
// reading an error's message without `instanceof` (bun:sqlite throws a
// SQLiteError with a `code` and a `message`).
import { Option, Schema } from "effect"

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
