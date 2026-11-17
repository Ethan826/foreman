// The transaction bracket the SQLite stores share (review finding F1): a
// write transaction is never left open. Tested against a fake connection
// that records each call and fails on command, since a real COMMIT failure
// cannot be produced on demand.
import { describe, expect, it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Ref } from "effect"
import { transaction } from "../../src/runtime/sqlite.ts"
import { openLedger } from "../../src/runtime/ledger-sqlite.ts"

type Call = "begin" | "commit" | "rollback"
const fakeConnection = (calls: Ref.Ref<ReadonlyArray<Call>>, failOn: ReadonlyArray<Call>) => {
  const record = (call: Call) =>
    Effect.flatMap(Ref.update(calls, (cs) => [...cs, call]), () =>
      failOn.includes(call) ? Effect.fail(`${call} failed` as const) : Effect.void,
    )
  return {
    begin: record("begin"),
    commit: record("commit"),
    rollback: record("rollback"),
    active: Effect.succeed(true),
  }
}

const run = <A, EB>(failOn: ReadonlyArray<Call>, body: Effect.Effect<A, EB>) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<Call>>([])
    const exit = yield* Effect.exit(transaction(fakeConnection(calls, failOn), body))
    return { exit, calls: yield* Ref.get(calls) }
  })

const commitFailureRollsBack = Effect.gen(function* () {
  const { exit, calls } = yield* run(["commit"], Effect.succeed(1))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(calls).toEqual(["begin", "commit", "rollback"])
})

const bodyFailureRollsBack = Effect.gen(function* () {
  const { exit, calls } = yield* run([], Effect.fail("body" as const))
  expect(exit).toEqual(Exit.fail("body"))
  expect(calls).toEqual(["begin", "rollback"])
})

const rollbackFailureSurfaces = Effect.gen(function* () {
  const { exit, calls } = yield* run(["rollback"], Effect.fail("body" as const))
  expect(exit).toEqual(Exit.fail("rollback failed"))
  expect(calls).toEqual(["begin", "rollback"])
})

const interruptionRollsBack = Effect.gen(function* () {
  const calls = yield* Ref.make<ReadonlyArray<Call>>([])
  const started = yield* Deferred.make<boolean>()
  const fiber = yield* Effect.forkChild(
    transaction(fakeConnection(calls, []), Effect.andThen(Deferred.succeed(started, true), Effect.never)),
  )
  yield* Deferred.await(started)
  yield* Fiber.interrupt(fiber)
  expect(yield* Ref.get(calls)).toEqual(["begin", "rollback"])
})

const memoryLedgerRefused = Effect.gen(function* () {
  const exit = yield* Effect.exit(Effect.scoped(openLedger(":memory:", 50)))
  expect(Exit.isFailure(exit)).toBe(true)
})

describe("transaction bracket", () => {
  it.effect("rolls back when COMMIT fails and reports the failure", () => commitFailureRollsBack)
  it.effect("rolls back when the body fails, without committing", () => bodyFailureRollsBack)
  it.effect("reports a failed ROLLBACK rather than swallowing it", () => rollbackFailureSurfaces)
  it.effect("rolls back when the body is interrupted", () => interruptionRollsBack)
})

describe("journal mode", () => {
  it.effect("refuses a ledger where WAL mode does not take effect", () => memoryLedgerRefused)
})
