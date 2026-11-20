// `status` (plan "Commands and their prerequisites", "Process
// evidence", "Slice A1", session-commands): it takes no lock and writes
// nothing, and it shows the state, incomplete attempts with their grants,
// holds, armed waivers, pins, the worktree check, report integrity and
// the advisory process evidence, labeled as evidence (status-evidence
// covers finished attempts and unrecorded launches).
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { writeFileSync } from "node:fs"
import { Clients } from "../../src/domain/clients.ts"
import { Finished, ProjectLogError, Waived } from "../../src/domain/events.ts"
import { WaiverId } from "../../src/domain/ids.ts"
import { implement } from "../../src/program/implement.ts"
import { evidenceCaveat, status } from "../../src/program/status.ts"
import { tryLock } from "../../src/runtime/project-lock.ts"
import { claudeCrash } from "../fixtures/clients/claude-crash.ts"
import { fakePid, fakeStartedAt } from "../fixtures/clients/fake-client.ts"
import { eventsOf, type Harness, head, rowsOf, withHarness } from "./session-harness.ts"
import { append, failureHold, firstIntent, open } from "./session-steps.ts"

const launchedIncomplete = (harness: Harness) =>
  Effect.gen(function* () {
    yield* open(harness)
    harness.inject.appendFails = Option.some((events) =>
      events.some(Schema.is(Finished)) ? Option.some(new ProjectLogError({ reason: "injected" })) : Option.none(),
    )
    yield* Effect.exit(implement(harness.context, { waive: false }))
  })

const statusReadsOnly = (harness: Harness) =>
  Effect.gen(function* () {
    yield* launchedIncomplete(harness)
    const events = yield* eventsOf(harness)
    const rows = yield* rowsOf(harness)
    harness.trace.length = 0
    const report = yield* Effect.scoped(
      Effect.andThen(tryLock(`${harness.dir}/lock.sqlite`), status(harness.status)),
    )
    expect(harness.trace).toEqual([])
    expect(yield* eventsOf(harness)).toEqual(events)
    expect(yield* rowsOf(harness)).toEqual(rows)
    const intent = yield* firstIntent(harness)
    expect(report.state).toMatchObject({ _tag: "AttemptIncomplete" })
    expect(report.incomplete).toEqual([{ opId: intent.opId, grantId: intent.grantId }])
    expect(report.launches).toMatchObject([{ opId: intent.opId, finished: false, evidence: { _tag: "NothingListed" } }])
    expect(report.evidenceCaveat).toBe(evidenceCaveat)
    expect(report.worktree).toEqual({ passed: true, detail: head })
    expect(report.pinsMatch).toEqual({ [Clients.Claude]: true, [Clients.Codex]: true })
  })

const statusNotLaunched = (harness: Harness) =>
  Effect.gen(function* () {
    harness.inject.startFails = true
    yield* open(harness)
    yield* Effect.exit(implement(harness.context, { waive: false }))
    const report = yield* status(harness.status)
    expect(report.launches).toMatchObject([{ evidence: { _tag: "LaunchUnknown" } }])
  })

const statusShowsEvidenceAndHolds = (harness: Harness) =>
  Effect.gen(function* () {
    yield* launchedIncomplete(harness)
    yield* append(harness, [failureHold, new Waived({ provider: Clients.Codex, waiverId: WaiverId.make("w-c") })])
    const listing = `  PID  PGID STARTED                      COMMAND\n ${String(fakePid)} ${String(fakePid)} ${fakeStartedAt} claude -p\n`
    const report = yield* status({
      ...harness.status,
      capabilities: { ...harness.status.capabilities, readProcesses: () => Effect.succeed(listing) },
    })
    expect(report.launches).toMatchObject([{ evidence: { _tag: "ProcessesListed", leader: { _tag: "LeaderListed" } } }])
    expect(report.holds).toMatchObject([{ _tag: "Failure" }])
    expect(report.armedWaivers).toEqual({ [Clients.Claude]: Option.none(), [Clients.Codex]: Option.some("w-c") })
  })

const statusReportIntegrity = (harness: Harness) =>
  Effect.gen(function* () {
    yield* open(harness)
    yield* implement(harness.context, { waive: false })
    const intent = yield* firstIntent(harness)
    expect((yield* status(harness.status)).reports).toEqual([
      { opId: intent.opId, rawIntact: true, handoffIntact: true },
    ])
    const report = (yield* status(harness.status)).state
    expect(report).toMatchObject({ _tag: "AwaitingHandoff", outcome: { _tag: "Crashed" } })
    const raw = harness.client.launches[0]?.rawPath.replace(/\.streaming$/, "") ?? ""
    writeFileSync(raw, "tampered\n")
    expect((yield* status(harness.status)).reports).toEqual([
      { opId: intent.opId, rawIntact: false, handoffIntact: true },
    ])
  })

const statusShowsPinAndWorktreeFailures = (harness: Harness) =>
  Effect.gen(function* () {
    const report = yield* status(harness.status)
    expect(report.state).toMatchObject({ _tag: "NoSession" })
    expect(report.pinsMatch).toEqual({ [Clients.Claude]: false, [Clients.Codex]: true })
    expect(report.worktree).toEqual({ passed: false, detail: "not locked" })
  })

const statusWithoutLedger = (harness: Harness) =>
  Effect.gen(function* () {
    yield* append(harness, [failureHold])
    const report = yield* status({
      ...harness.status,
      capabilities: { ...harness.status.capabilities, ledgerRows: Effect.succeed(Option.none()) },
    })
    expect(report.ledgerFound).toBe(false)
    expect(report.holds).toMatchObject([{ _tag: "Failure" }])
    expect((yield* status(harness.status)).ledgerFound).toBe(true)
  })

describe("status", () => {
  it.effect("reads without the lock and writes nothing", () => withHarness({}, statusReadsOnly))
  it.effect("shows an attempt with no recorded launch as unknown", () => withHarness({}, statusNotLaunched))
  it.effect("shows advisory evidence, holds and armed waivers", () => withHarness({}, statusShowsEvidenceAndHolds))
  it.effect("shows report integrity and a crashed outcome", () =>
    withHarness({ script: claudeCrash }, statusReportIntegrity),
  )
  it.effect("reads a missing ledger as no rows and says it is missing", () => withHarness({}, statusWithoutLedger))
  it.effect("shows a pin mismatch and a failed worktree check", () =>
    withHarness({ installed: "2.1.329 (Claude Code)", worktreePasses: false }, statusShowsPinAndWorktreeFailures),
  )
})
