// Crash points of the launch protocol (plan "Write protocol", the crash
// table, and "Slice A1", attempt-crash): a failure injected after each
// write leaves the state the table names, the next command the table
// allows works, and no retry launches a client twice.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Exit, Option, Schema } from "effect"
import { existsSync } from "node:fs"
import {
  Finished,
  HoldCreated,
  Intended,
  Launched,
  PositionMoved,
  type ProjectEvent,
  ProjectLogError,
  StepEndedByOwner,
  Waived,
  LogPosition,
} from "../../src/domain/events.ts"
import { TrancheId } from "../../src/domain/ids.ts"
import { Charged, Grant, GrantCanceled, type LedgerRow } from "../../src/domain/ledger.ts"
import { CloseKinds } from "../../src/domain/session.ts"
import { implement } from "../../src/program/implement.ts"
import { closeSession, openSession, stepEnded } from "../../src/program/session.ts"
import { CommandRefused, LostRace } from "../../src/program/session-errors.ts"
import { eventsOf, type Harness, ledgerRows, logBatch, published, rowsOf, withHarness } from "./session-harness.ts"

const tranche = TrancheId.make("t-1")

const opened = (harness: Harness) =>
  Effect.gen(function* () {
    yield* openSession(harness.context, { tranche, taskFile: harness.taskFile })
    harness.trace.length = 0
  })

const failLogWhen = (
  harness: Harness,
  has: (event: ProjectEvent) => boolean,
  error: PositionMoved | ProjectLogError = new ProjectLogError({ reason: "injected" }),
) => {
  harness.inject.appendFails = Option.some((events) => (events.some(has) ? Option.some(error) : Option.none()))
}

const failLedgerWhen = (harness: Harness, has: (row: LedgerRow) => boolean) => {
  harness.inject.ledgerAppendFails = Option.some((rows) => rows.some(has))
}

const count = (items: ReadonlyArray<unknown>, guard: (item: unknown) => boolean) => Arr.filter(items, guard).length

const failed = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true)
}

const refusedRetry = (harness: Harness) =>
  Effect.gen(function* () {
    const before = yield* eventsOf(harness)
    const exit = yield* Effect.exit(implement(harness.context, { waive: true }))
    expect(Exit.isFailure(exit) && Option.exists(Exit.findErrorOption(exit), Schema.is(CommandRefused))).toBe(true)
    expect(yield* eventsOf(harness)).toEqual(before)
  })

/** The owner's way out of an incomplete attempt: step-ended, then close --interrupted. */
const interruptedClose = (harness: Harness) =>
  Effect.gen(function* () {
    const intent = yield* Effect.fromOption(Arr.findFirst(yield* eventsOf(harness), Schema.is(Intended)))
    yield* stepEnded(harness.context, { opId: intent.opId, grantId: intent.grantId })
    yield* closeSession(harness.context, { how: CloseKinds.Interrupted, note: "" })
    const rows = yield* rowsOf(harness)
    expect(count(rows, Schema.is(Charged))).toBe(1)
    expect(count(yield* eventsOf(harness), Schema.is(StepEndedByOwner))).toBe(1)
  })

const afterBatchQ = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    failLogWhen(harness, Schema.is(Waived))
    failed(yield* Effect.exit(implement(harness.context, { waive: true })))
    expect(harness.trace).toMatchObject([logBatch("HoldCreated")])
    harness.trace.length = 0
    yield* implement(harness.context, { waive: true })
    expect(harness.trace.slice(0, 4)).toMatchObject([
      logBatch("Waived"),
      ledgerRows("Grant"),
      published("brief.md"),
      logBatch("Intended", "BriefRecorded"),
    ])
    expect(count(yield* eventsOf(harness), Schema.is(HoldCreated))).toBe(1)
    expect(harness.client.launches.length).toBe(1)
  })

const afterBatchQClose = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    failed(yield* Effect.exit(implement(harness.context, { waive: false })))
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" })
    expect(count(yield* eventsOf(harness), Schema.is(HoldCreated))).toBe(1)
    expect(harness.client.launches).toEqual([])
  })

const afterBatchW = (waive: boolean) => (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    failLedgerWhen(harness, Schema.is(Grant))
    failed(yield* Effect.exit(implement(harness.context, { waive: true })))
    expect(harness.trace).toMatchObject([logBatch("HoldCreated"), logBatch("Waived")])
    harness.trace.length = 0
    yield* implement(harness.context, { waive })
    expect(harness.trace.slice(0, 3)).toMatchObject([ledgerRows("Grant"), published("brief.md"), logBatch("Intended", "BriefRecorded")])
    expect(count(yield* eventsOf(harness), Schema.is(Waived))).toBe(1)
    expect(harness.client.launches.length).toBe(1)
  })

const afterGrant = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    failLogWhen(harness, Schema.is(Intended))
    failed(yield* Effect.exit(implement(harness.context, { waive: false })))
    expect(harness.trace).toMatchObject([ledgerRows("Grant"), published("brief.md")])
    harness.trace.length = 0
    yield* implement(harness.context, { waive: false })
    expect(harness.trace.slice(0, 4)).toMatchObject([
      ledgerRows("GrantCanceled"),
      ledgerRows("Grant"),
      published("brief.md"),
      logBatch("Intended", "BriefRecorded"),
    ])
    const canceled = Arr.filter(yield* rowsOf(harness), Schema.is(GrantCanceled))
    expect(canceled.map((row) => row.cause)).toEqual(["orphan"])
    expect(harness.client.launches.length).toBe(1)
  })

const afterBatchI = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    harness.inject.startFails = true
    failed(yield* Effect.exit(implement(harness.context, { waive: false })))
    expect(harness.trace).toMatchObject([ledgerRows("Grant"), published("brief.md"), logBatch("Intended", "BriefRecorded")])
    harness.inject.startFails = false
    yield* refusedRetry(harness)
    expect(harness.client.launches).toEqual([])
    yield* interruptedClose(harness)
  })

const afterBatchL = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    failLogWhen(harness, Schema.is(Finished))
    failed(yield* Effect.exit(implement(harness.context, { waive: false })))
    expect(count(yield* eventsOf(harness), Schema.is(Launched))).toBe(1)
    expect(count(yield* eventsOf(harness), Schema.is(Finished))).toBe(0)
    yield* refusedRetry(harness)
    expect(harness.client.launches.length).toBe(1)
    yield* interruptedClose(harness)
  })

const afterRawPublished = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    harness.inject.publishFails = Option.some((path) => path.endsWith(".handoff.md"))
    failed(yield* Effect.exit(implement(harness.context, { waive: false })))
    const [intent] = Arr.filter(yield* eventsOf(harness), Schema.is(Intended))
    const sessionPrefix = harness.client.launches[0]?.rawPath.replace(/\.streaming$/, "") ?? ""
    expect(existsSync(sessionPrefix)).toBe(true)
    expect(sessionPrefix).toContain(intent?.opId ?? "missing")
    expect(count(yield* eventsOf(harness), Schema.is(Finished))).toBe(0)
    yield* refusedRetry(harness)
    expect(harness.client.launches.length).toBe(1)
    yield* interruptedClose(harness)
  })

const afterBatchF = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    failLedgerWhen(harness, Schema.is(Charged))
    failed(yield* Effect.exit(implement(harness.context, { waive: false })))
    expect(count(yield* eventsOf(harness), Schema.is(Finished))).toBe(1)
    expect(count(yield* rowsOf(harness), Schema.is(Charged))).toBe(0)
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" })
    expect(count(yield* rowsOf(harness), Schema.is(Charged))).toBe(1)
    expect(harness.client.launches.length).toBe(1)
  })

const failedSettle = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    failLogWhen(harness, Schema.is(Intended))
    failed(yield* Effect.exit(implement(harness.context, { waive: false })))
    failLedgerWhen(harness, Schema.is(GrantCanceled))
    const rowsBefore = yield* rowsOf(harness)
    harness.trace.length = 0
    failed(yield* Effect.exit(implement(harness.context, { waive: false })))
    expect(yield* rowsOf(harness)).toEqual(rowsBefore)
    expect(harness.trace).toEqual([])
    yield* implement(harness.context, { waive: false })
    expect(count(yield* rowsOf(harness), Schema.is(GrantCanceled))).toBe(1)
    expect(harness.client.launches.length).toBe(1)
  })

const movedOnBatchI = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    const moved = new PositionMoved({ expected: LogPosition.make(0), actual: LogPosition.make(1) })
    failLogWhen(harness, Schema.is(Intended), moved)
    const exit = yield* Effect.exit(implement(harness.context, { waive: false }))
    expect(Exit.isFailure(exit) && Option.exists(Exit.findErrorOption(exit), Schema.is(LostRace))).toBe(true)
    expect(harness.trace).toMatchObject([ledgerRows("Grant"), published("brief.md"), ledgerRows("GrantCanceled")])
    const canceled = Arr.filter(yield* rowsOf(harness), Schema.is(GrantCanceled))
    expect(canceled.map((row) => row.cause)).toEqual(["lostRace"])
    expect(count(yield* eventsOf(harness), Schema.is(Intended))).toBe(0)
    expect(harness.client.launches).toEqual([])
    yield* implement(harness.context, { waive: false })
    expect(harness.client.launches.length).toBe(1)
  })

describe("implement: crash points", () => {
  it.effect("after batch Q, the retry with --waive skips Q and writes W", () =>
    withHarness({ allowing: false }, afterBatchQ),
  )
  it.effect("after batch Q, close --abandoned works and leaves the hold", () =>
    withHarness({ allowing: false }, afterBatchQClose),
  )
  it.effect("after batch W, a retry with --waive uses the armed waiver and writes no second Waived", () =>
    withHarness({ allowing: false }, afterBatchW(true)),
  )
  it.effect("after batch W, a retry without --waive uses the armed waiver", () =>
    withHarness({ allowing: false }, afterBatchW(false)),
  )
  it.effect("after the grant, the next settle cancels it orphan and the retry launches once", () =>
    withHarness({}, afterGrant),
  )
  it.effect("after batch I, the attempt is incomplete: retry refused, step-ended and close --interrupted", () =>
    withHarness({}, afterBatchI),
  )
  it.effect("after batch L, the attempt is incomplete and the retry never launches again", () =>
    withHarness({}, afterBatchL),
  )
  it.effect("after the raw file's publication, it stays as an orphan and the attempt is incomplete", () =>
    withHarness({}, afterRawPublished),
  )
  it.effect("after batch F, the charge is pending and the next settle writes it", () => withHarness({}, afterBatchF))
  it.effect("a failed settle transaction writes nothing and launches nothing; the next settle runs", () =>
    withHarness({}, failedSettle),
  )
  it.effect("PositionMoved on batch I cancels the grant as a lost race and launches nothing", () =>
    withHarness({}, movedOnBatchI),
  )
})
