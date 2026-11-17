// The project lock never leaks its connection (review finding F2): a
// failed acquisition closes the connection it opened, a failed ROLLBACK
// on release still closes it, and a failing close is reported beside the
// failure that came first rather than hiding or replacing it. Failures
// are injected by a connection that hands a chosen statement to SQLite as
// invalid SQL, so each error is a real SQLiteError.
import { Database } from "bun:sqlite"
import { describe, expect, it } from "@effect/vitest"
import { Cause, Effect } from "effect"
import { ProjectLogError } from "../../src/domain/events.ts"
import type { LockConnection } from "../../src/runtime/project-lock.ts"
import { tryLockWith } from "../../src/runtime/project-lock.ts"

const closeCall = "close"
const begin = "BEGIN EXCLUSIVE"
const rollback = "ROLLBACK"

/**
 * The invalid statement run in place of a failing call. It names the
 * call, so two injected failures differ: a Cause drops a reason equal to
 * one it already holds.
 */
const injectedSql = (call: string) => `injected_${call.replaceAll(" ", "_")}`

/** SQLite's message for the statement injected in place of a call. */
const reasonFor = (call: string) => `near "${injectedSql(call)}": syntax error`

/** The typed failure the injected statement becomes. */
const injected = (call: string) => new ProjectLogError({ reason: reasonFor(call) })

interface Recorded {
  readonly calls: Array<string>
  readonly open: (path: string) => LockConnection
}

/** An in-memory connection that records each call and fails the listed ones. */
const recording = (failing: ReadonlyArray<string>): Recorded => {
  const calls: Array<string> = []
  const db = new Database(":memory:")
  const run = (call: string, act: () => void) => {
    calls.push(call)
    if (failing.includes(call)) db.exec(injectedSql(call))
    else act()
  }
  const conn: LockConnection = {
    exec: (sql) => { run(sql, () => { db.exec(sql) }) },
    close: () => { run(closeCall, () => { db.close() }) },
  }
  return { calls, open: () => conn }
}

/** The cause of a failed scoped lock; the test fails if the lock succeeds. */
const causeOf = (recorded: Recorded) =>
  Effect.flip(Effect.sandbox(Effect.scoped(tryLockWith(recorded.open)("lock"))))

const reasonsOf = (cause: Cause.Cause<unknown>) => ({
  failures: cause.reasons.filter(Cause.isFailReason).map((reason) => reason.error),
  defects: cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect),
})

const messages = (values: ReadonlyArray<unknown>) =>
  values.map((value) => String(Reflect.get(Object(value), "message")))

describe("project lock cleanup", () => {
  it.effect("closes the opened connection when BEGIN EXCLUSIVE fails", () =>
    Effect.gen(function* () {
      const recorded = recording([begin])
      const { failures, defects } = reasonsOf(yield* causeOf(recorded))
      expect(failures).toEqual([injected(begin)])
      expect(defects).toEqual([])
      expect(recorded.calls.at(-1)).toBe(closeCall)
    }),
  )

  it.effect("reports a failed close beside the failed acquisition", () =>
    Effect.gen(function* () {
      const recorded = recording([begin, closeCall])
      const { failures } = reasonsOf(yield* causeOf(recorded))
      expect(failures).toEqual([injected(begin), injected(closeCall)])
      expect(recorded.calls.at(-1)).toBe(closeCall)
    }),
  )

  it.effect("still closes when ROLLBACK fails on release, reporting the failure", () =>
    Effect.gen(function* () {
      const recorded = recording([rollback])
      const { defects } = reasonsOf(yield* causeOf(recorded))
      expect(messages(defects)).toEqual([reasonFor(rollback)])
      expect(recorded.calls.slice(-2)).toEqual([rollback, closeCall])
    }),
  )

  it.effect("reports both a failed ROLLBACK and a failed close on release", () =>
    Effect.gen(function* () {
      const recorded = recording([rollback, closeCall])
      const { defects } = reasonsOf(yield* causeOf(recorded))
      expect(messages(defects)).toEqual([reasonFor(rollback), reasonFor(closeCall)])
      expect(recorded.calls.slice(-2)).toEqual([rollback, closeCall])
    }),
  )
})
