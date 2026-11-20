// Crash points of `review` and `correct` (plan "Slice A2",
// handoff-crash; "Write protocol", the crash table): a failure injected
// after the snapshot's staging, batch W, the grant, batch I, batch L and
// batch F leaves the state the table names, the next command the table
// allows works, and no retry launches a client twice. A refused retry
// stages nothing, and the settle step cancels an orphan grant before the
// retry takes its own.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Exit, Option, Schema } from "effect"
import {
  Finished,
  Intended,
  Launched,
  type ProjectEvent,
  ProjectLogError,
  SnapshotTaken,
  StepEndedByOwner,
  Waived,
} from "../../src/domain/events.ts"
import { Clients } from "../../src/domain/clients.ts"
import { Charged, Grant, GrantCanceled, type LedgerRow } from "../../src/domain/ledger.ts"
import { CloseKinds } from "../../src/domain/session.ts"
import { correct } from "../../src/program/correct.ts"
import { review } from "../../src/program/review.ts"
import { closeSession, stepEnded } from "../../src/program/session.ts"
import { CommandRefused } from "../../src/program/session-errors.ts"
import { claudeSuccess } from "../fixtures/clients/claude-success.ts"
import { codexReviewFindings } from "../fixtures/clients/codex-review-findings.ts"
import { afterImplement, commandOfCall, ownerFindings, reviewed } from "./handoff-steps.ts"
import { eventsOf, type Harness, ledgerRows, rowsOf, withHarness } from "./session-harness.ts"
import { append, quotaHold } from "./session-steps.ts"

/** One handoff command under test: how to reach it, how to run it, and the failure right after staging. */
interface Case {
  readonly name: string
  /** Opens a session and runs the steps before the command. */
  readonly setup: (harness: Harness) => Effect.Effect<unknown, unknown>
  /** Runs the command once, queuing its client's script if none is queued. */
  readonly run: (harness: Harness, waive: boolean) => Effect.Effect<unknown, unknown>
  /** Injects a failure in the first step after the snapshot is staged. */
  readonly failAfterStaging: (harness: Harness) => void
  /** Puts a quota hold of the command's provider in place, so the waiver step runs. */
  readonly holdProvider: (harness: Harness) => Effect.Effect<unknown, unknown>
}

/** Queues `script` unless a script is already waiting. */
const queued = (harness: Harness, script: typeof claudeSuccess) => {
  if (harness.client.queue.length === 0) harness.client.queue.push(script)
}

const reviewCase: Case = {
  name: "review",
  setup: afterImplement,
  run: (harness, waive) =>
    Effect.suspend(() => {
      queued(harness, codexReviewFindings)
      return review(harness.context, { waive, attest: true })
    }),
  failAfterStaging: (harness) => {
    harness.inject.gitFails = Option.some((args) => args[0] === "diff-tree")
  },
  holdProvider: () => Effect.void,
}

const correctCase: Case = {
  name: "correct",
  setup: (harness) => Effect.andThen(Effect.andThen(afterImplement(harness), reviewed(harness)), ownerFindings(harness)),
  run: (harness, waive) =>
    Effect.suspend(() => {
      queued(harness, claudeSuccess)
      return correct(harness.context, { findingsFile: `${harness.dir}/owner-findings.md`, waive, attest: true })
    }),
  failAfterStaging: (harness) => {
    harness.inject.publishFails = Option.some((path) => path.endsWith(".findings.md"))
  },
  holdProvider: (harness) => append(harness, [quotaHold(Clients.Claude)]),
}

const failLogWhen = (harness: Harness, has: (event: ProjectEvent) => boolean) => {
  harness.inject.appendFails = Option.some((events) =>
    events.some(has) ? Option.some(new ProjectLogError({ reason: "injected" })) : Option.none(),
  )
}

const failLedgerWhen = (harness: Harness, has: (row: LedgerRow) => boolean) => {
  harness.inject.ledgerAppendFails = Option.some((rows) => rows.some(has))
}

const count = (items: ReadonlyArray<unknown>, guard: (item: unknown) => boolean) => Arr.filter(items, guard).length

const failed = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true)
}

/** Runs the command, and returns the events it appended. */
const appendedBy = (harness: Harness, run: Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* () {
    const before = (yield* eventsOf(harness)).length
    yield* run
    return (yield* eventsOf(harness)).slice(before)
  })

/** Runs the command expecting a failure, and returns the events it appended. */
const failedRun = (harness: Harness, run: Effect.Effect<unknown, unknown>) =>
  appendedBy(harness, Effect.flatMap(Effect.exit(run), (exit) => Effect.sync(() => {
    failed(exit)
  })))

/** A retry refused by the rules, appending nothing, staging nothing and launching nothing. */
const refusedRetry = (harness: Harness, testCase: Case) =>
  Effect.gen(function* () {
    const before = yield* eventsOf(harness)
    const launches = harness.client.launches.length
    const gitCalls = harness.gitCalls.length
    const exit = yield* Effect.exit(testCase.run(harness, true))
    expect(Exit.isFailure(exit) && Option.exists(Exit.findErrorOption(exit), Schema.is(CommandRefused))).toBe(true)
    expect(yield* eventsOf(harness)).toEqual(before)
    expect(harness.client.launches.length).toBe(launches)
    expect(harness.gitCalls.length).toBe(gitCalls)
  })

/** The owner's way out of an incomplete attempt: step-ended, then close --interrupted. */
const interruptedClose = (harness: Harness) =>
  Effect.gen(function* () {
    const intent = yield* Effect.fromOption(Arr.findLast(yield* eventsOf(harness), Schema.is(Intended)))
    yield* stepEnded(harness.context, { opId: intent.opId, grantId: intent.grantId })
    yield* closeSession(harness.context, { how: CloseKinds.Interrupted, note: "" })
    expect(count(yield* eventsOf(harness), Schema.is(StepEndedByOwner))).toBe(1)
    const charged = Arr.filter(yield* rowsOf(harness), Schema.is(Charged))
    expect(charged.map((row) => row.grantId)).toContain(intent.grantId)
  })

const afterStaging = (testCase: Case) => (harness: Harness) =>
  Effect.gen(function* () {
    yield* testCase.setup(harness)
    const launches = harness.client.launches.length
    testCase.failAfterStaging(harness)
    const appended = yield* failedRun(harness, testCase.run(harness, true))
    expect(harness.gitCalls.some((call) => commandOfCall(call)[0] === "write-tree")).toBe(true)
    expect(appended).toEqual([])
    expect(harness.client.launches.length).toBe(launches)
    yield* testCase.run(harness, true)
    expect(harness.client.launches.length).toBe(launches + 1)
  })

const afterBatchW = (testCase: Case) => (harness: Harness) =>
  Effect.gen(function* () {
    yield* testCase.setup(harness)
    yield* testCase.holdProvider(harness)
    const launches = harness.client.launches.length
    failLedgerWhen(harness, Schema.is(Grant))
    const appended = yield* failedRun(harness, testCase.run(harness, true))
    expect(count(appended, Schema.is(Waived))).toBe(1)
    expect(count(appended, Schema.is(Intended))).toBe(0)
    const retried = yield* appendedBy(harness, testCase.run(harness, false))
    expect(count(retried, Schema.is(Waived))).toBe(0)
    expect(Arr.findFirst(retried, Schema.is(Intended)).pipe(Option.flatMap((intent) => intent.waiverId))).toEqual(
      Option.map(Arr.findFirst(appended, Schema.is(Waived)), (waived) => waived.waiverId),
    )
    expect(harness.client.launches.length).toBe(launches + 1)
  })

const afterGrant = (testCase: Case) => (harness: Harness) =>
  Effect.gen(function* () {
    yield* testCase.setup(harness)
    const launches = harness.client.launches.length
    failLogWhen(harness, Schema.is(Intended))
    const appended = yield* failedRun(harness, testCase.run(harness, true))
    expect(count(appended, Schema.is(Intended))).toBe(0)
    expect(count(appended, Schema.is(SnapshotTaken))).toBe(0)
    harness.trace.length = 0
    yield* testCase.run(harness, true)
    expect(harness.trace[0]).toMatchObject(ledgerRows("GrantCanceled"))
    const canceled = Arr.filter(yield* rowsOf(harness), Schema.is(GrantCanceled))
    expect(canceled.map((row) => row.cause)).toEqual(["orphan"])
    expect(harness.client.launches.length).toBe(launches + 1)
  })

const afterBatchI = (testCase: Case) => (harness: Harness) =>
  Effect.gen(function* () {
    yield* testCase.setup(harness)
    const launches = harness.client.launches.length
    harness.inject.startFails = true
    const appended = yield* failedRun(harness, testCase.run(harness, true))
    expect(count(appended, Schema.is(Intended))).toBe(1)
    expect(count(appended, Schema.is(Launched))).toBe(0)
    harness.inject.startFails = false
    yield* refusedRetry(harness, testCase)
    expect(harness.client.launches.length).toBe(launches)
    yield* interruptedClose(harness)
  })

const afterBatchL = (testCase: Case) => (harness: Harness) =>
  Effect.gen(function* () {
    yield* testCase.setup(harness)
    const launches = harness.client.launches.length
    failLogWhen(harness, Schema.is(Finished))
    const appended = yield* failedRun(harness, testCase.run(harness, true))
    expect(count(appended, Schema.is(Launched))).toBe(1)
    expect(count(appended, Schema.is(Finished))).toBe(0)
    yield* refusedRetry(harness, testCase)
    expect(harness.client.launches.length).toBe(launches + 1)
    yield* interruptedClose(harness)
  })

const afterBatchF = (testCase: Case) => (harness: Harness) =>
  Effect.gen(function* () {
    yield* testCase.setup(harness)
    const launches = harness.client.launches.length
    const chargedBefore = count(yield* rowsOf(harness), Schema.is(Charged))
    failLedgerWhen(harness, Schema.is(Charged))
    const appended = yield* failedRun(harness, testCase.run(harness, true))
    expect(count(appended, Schema.is(Finished))).toBe(1)
    expect(count(yield* rowsOf(harness), Schema.is(Charged))).toBe(chargedBefore)
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" })
    expect(count(yield* rowsOf(harness), Schema.is(Charged))).toBe(chargedBefore + 1)
    expect(harness.client.launches.length).toBe(launches + 1)
  })

describe.each([reviewCase, correctCase])("$name: crash points", (testCase) => {
  it.effect("after the snapshot is staged, nothing is recorded and the retry launches once", () =>
    withHarness({ repository: true }, afterStaging(testCase)))
  it.effect("after batch W, a retry without --waive uses the armed waiver and writes no second Waived", () =>
    withHarness({ repository: true }, afterBatchW(testCase)))
  it.effect("after the grant, the next settle cancels it orphan and the retry launches once", () =>
    withHarness({ repository: true }, afterGrant(testCase)))
  it.effect("after batch I, the attempt is incomplete: retry refused, step-ended and close --interrupted", () =>
    withHarness({ repository: true }, afterBatchI(testCase)))
  it.effect("after batch L, the attempt is incomplete and the retry never launches again", () =>
    withHarness({ repository: true }, afterBatchL(testCase)))
  it.effect("after batch F, the charge is pending and the next settle writes it", () =>
    withHarness({ repository: true }, afterBatchF(testCase)))
})
