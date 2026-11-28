// The busy-wait contract's check for a store's production open (dogfood-6f,
// owner ruling of 2026-11-28). A store's `...With(connect)` open is given a
// connect function that calls the production `connectSqlite` and records
// the connection it returned; after the open, the connection's busy
// timeout is read back with `busyTimeoutOf`. The open, not the connect
// function, sets `busy_timeout`, so an open that ignored its timeout
// argument fails the check.
import type { Database } from "bun:sqlite"
import { expect } from "@effect/vitest"
import { Effect, MutableRef, Option } from "effect"
import type { Scope } from "effect"
import { busyTimeoutOf, type ConnectSqlite, connectSqlite } from "../../src/runtime/sqlite.ts"

/** Two busy timeouts, in milliseconds, that differ, so a hard-coded value fails one of them. */
export const configuredBusyMillis = [1_234, 4_321] as const

/** A connect function that calls `connectSqlite` and records the last connection it returned. */
const recordingConnect = () => {
  const recorded = MutableRef.make(Option.none<Database>())
  const connect: ConnectSqlite = (path) => {
    const db = connectSqlite(path)
    MutableRef.set(recorded, Option.some(db))
    return db
  }
  return { connect, last: Effect.suspend(() => Effect.fromOption(MutableRef.get(recorded))) }
}

/**
 * Opens the store at `path` with `openWith`, once for each of
 * {@link configuredBusyMillis}, and expects the connection the open made
 * to carry that busy timeout.
 */
export const expectConfiguredBusyTimeout = <A, E>(
  openWith: (connect: ConnectSqlite) => (path: string, busyTimeoutMillis: number) => Effect.Effect<A, E, Scope.Scope>,
  path: string,
) =>
  Effect.forEach(configuredBusyMillis, (millis) =>
    Effect.scoped(
      Effect.gen(function* () {
        const recording = recordingConnect()
        yield* openWith(recording.connect)(path, millis)
        const db = yield* recording.last
        expect(yield* busyTimeoutOf(db, (error) => error)).toBe(millis)
      }),
    ),
  )
