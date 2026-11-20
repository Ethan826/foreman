// The owner's session commands (plan "Commands and their prerequisites",
// "Close rules", "Settlement for owner-ended steps", "Slice A1",
// session-commands): open, a duplicate implement, step-ended and its
// refusals, and close and its rules. `status` is in session-status.test.ts.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Exit, Option, Schema } from "effect"
import { readFileSync, writeFileSync } from "node:fs"
import { Clients } from "../../src/domain/clients.ts"
import {
  Approved,
  HoldCreated,
  LogPosition,
  type ProjectEvent,
  SessionOpened,
  StepEndedByOwner,
  Waived,
  WaiverExpired,
} from "../../src/domain/events.ts"
import { Quota } from "../../src/domain/holds.ts"
import { GrantId, LedgerSeq, OpId, WaiverId } from "../../src/domain/ids.ts"
import { Unclassified } from "../../src/domain/outcomes.ts"
import { CloseKinds } from "../../src/domain/session.ts"
import { holdsOf } from "../../src/features/holds.ts"
import { implement } from "../../src/program/implement.ts"
import { closeSession, stepEnded } from "../../src/program/session.ts"
import { TaskFileChanged } from "../../src/program/session-errors.ts"
import { sha256Of } from "../../src/runtime/state-files.ts"
import { claudeCrash } from "../fixtures/clients/claude-crash.ts"
import { claudeRateLimited } from "../fixtures/clients/claude-rate-limited.ts"
import { eventsOf, type Harness, head, logBatch, withHarness } from "./session-harness.ts"
import { append, failureHold, firstIntent, open, refusedFor, tranche } from "./session-steps.ts"

const claudeQuota = new HoldCreated({
  hold: new Quota({ provider: Clients.Claude, windows: [], heldMono: Option.none(), ledgerSeq: LedgerSeq.make(1) }),
})

const opensInOneBatch = (harness: Harness) =>
  Effect.gen(function* () {
    const opened = yield* open(harness)
    expect(harness.trace).toMatchObject([{ kind: "publish" }, logBatch("SessionOpened", "Approved")])
    expect(opened.baseRevision).toBe(head)
    expect(opened.tranche).toBe(tranche)
    expect(opened.worktree).toEqual({
      path: harness.worktree.path,
      gitDir: harness.worktree.gitDir,
      commonDir: harness.worktree.commonDir,
    })
    expect(opened.taskPath.startsWith(harness.dir)).toBe(true)
    expect(sha256Of(readFileSync(opened.taskPath))).toBe(opened.taskSha256)
    const approved = Arr.filter(yield* eventsOf(harness), Schema.is(Approved))
    expect(approved).toEqual([new Approved({ tranche, revision: head, permits: [], base: Option.none() })])
  })

const openRefusals = (harness: Harness) =>
  Effect.gen(function* () {
    yield* append(harness, [failureHold])
    yield* refusedFor(harness, open(harness), ["HeldBy"])
  })

const openWithQuotaHold = (harness: Harness) =>
  Effect.gen(function* () {
    yield* append(harness, [claudeQuota])
    yield* open(harness)
    expect(Arr.filter(yield* eventsOf(harness), Schema.is(SessionOpened)).length).toBe(1)
  })

const openTwice = (harness: Harness) =>
  Effect.gen(function* () {
    yield* open(harness)
    yield* refusedFor(harness, open(harness), ["WrongState"])
  })

const duplicateImplement = (harness: Harness) =>
  Effect.gen(function* () {
    yield* open(harness)
    yield* implement(harness.context, { waive: false })
    yield* refusedFor(harness, implement(harness.context, { waive: true }), ["WrongState"])
    expect(harness.client.launches.length).toBe(1)
  })

const changedTask = (harness: Harness) =>
  Effect.gen(function* () {
    const opened = yield* open(harness)
    writeFileSync(opened.taskPath, "Delete everything.\n")
    const before = yield* eventsOf(harness)
    const exit = yield* Effect.exit(implement(harness.context, { waive: false }))
    const error = Exit.isFailure(exit) ? Exit.findErrorOption(exit) : Option.none()
    expect(Option.exists(error, Schema.is(TaskFileChanged))).toBe(true)
    expect(yield* eventsOf(harness)).toEqual(before)
    expect(harness.client.launches).toEqual([])
  })

const stepEndedRefusals = (harness: Harness) =>
  Effect.gen(function* () {
    yield* open(harness)
    yield* Effect.exit(implement(harness.context, { waive: false }))
    const intent = yield* firstIntent(harness)
    const wrongGrant = stepEnded(harness.context, { opId: intent.opId, grantId: GrantId.make("g-other") })
    yield* refusedFor(harness, wrongGrant, ["WrongGrant"])
    const unknown = stepEnded(harness.context, { opId: OpId.make("op-unknown"), grantId: intent.grantId })
    yield* refusedFor(harness, unknown, ["NotIncomplete"])
    yield* stepEnded(harness.context, { opId: intent.opId, grantId: intent.grantId })
    yield* refusedFor(harness, stepEnded(harness.context, intent), ["AlreadyAttested"])
    expect(Arr.filter(yield* eventsOf(harness), Schema.is(StepEndedByOwner)).length).toBe(1)
  })

const interruptedBeforeStepEnded = (harness: Harness) =>
  Effect.gen(function* () {
    yield* open(harness)
    yield* Effect.exit(implement(harness.context, { waive: false }))
    const close = closeSession(harness.context, { how: CloseKinds.Interrupted, note: "" })
    yield* refusedFor(harness, close, ["WrongState"])
    yield* refusedFor(harness, closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" }), ["WrongState"])
  })

const closeExpiresWaiver = (harness: Harness) =>
  Effect.gen(function* () {
    yield* open(harness)
    yield* append(harness, [new Waived({ provider: Clients.Codex, waiverId: WaiverId.make("w-codex") })])
    harness.trace.length = 0
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "done for today" })
    expect(harness.trace).toMatchObject([logBatch("SessionClosed", "WaiverExpired")])
    const expired = Arr.filter(yield* eventsOf(harness), Schema.is(WaiverExpired))
    expect(expired).toEqual([new WaiverExpired({ waiverId: WaiverId.make("w-codex") })])
  })

const closeLeavesHolds = (harness: Harness) =>
  Effect.gen(function* () {
    yield* open(harness)
    yield* append(harness, [failureHold, claudeQuota])
    const logged = (events: ReadonlyArray<ProjectEvent>) =>
      events.map((event, index) => ({ position: LogPosition.make(index + 1), event }))
    const before = holdsOf(logged(yield* eventsOf(harness)))
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" })
    expect(holdsOf(logged(yield* eventsOf(harness)))).toEqual(before)
    expect(before.length).toBe(2)
  })

const closeWithBrokenWorktree = (harness: Harness) =>
  Effect.gen(function* () {
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" })
  })

/** Runs implement with batch F failing, so the attempt is launched and incomplete. */
const rateLimitedIsCloseOnly = (harness: Harness) =>
  Effect.gen(function* () {
    yield* open(harness)
    const recorded = yield* implement(harness.context, { waive: false })
    expect(recorded.outcome).toEqual(new Unclassified())
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" })
  })

describe("session open", () => {
  it.effect("appends SessionOpened and Approved at the worktree's HEAD in one batch", () =>
    withHarness({}, opensInOneBatch),
  )
  it.effect("refuses with a non-quota hold and appends nothing", () => withHarness({}, openRefusals))
  it.effect("opens with a quota hold in place", () => withHarness({}, openWithQuotaHold))
  it.effect("refuses while a session is open", () => withHarness({}, openTwice))
  it.effect("refuses when the worktree check fails", () =>
    withHarness({ worktreePasses: false }, (harness) => refusedFor(harness, open(harness), ["WorktreeCheckFailed"])),
  )
})

describe("implement, step-ended and close", () => {
  it.effect("a duplicate implement is refused and launches nothing", () => withHarness({}, duplicateImplement))
  it.effect("implement refuses a task file whose hash changed and launches nothing", () =>
    withHarness({}, changedTask),
  )
  it.effect("step-ended refuses a wrong grant, an unknown opId and a second attestation", () =>
    withHarness({ script: claudeCrash }, (harness) => {
      harness.inject.startFails = true
      return stepEndedRefusals(harness)
    }),
  )
  it.effect("close --interrupted before step-ended is refused, and so is --abandoned", () =>
    withHarness({}, (harness) => {
      harness.inject.startFails = true
      return interruptedBeforeStepEnded(harness)
    }),
  )
  it.effect("close expires an armed waiver in the same batch", () => withHarness({}, closeExpiresWaiver))
  it.effect("close leaves every hold in place", () => withHarness({}, closeLeavesHolds))
  it.effect("close --abandoned with no session is refused even with a broken worktree", () =>
    withHarness({ worktreePasses: false }, (harness) =>
      refusedFor(harness, closeWithBrokenWorktree(harness), ["WrongState"]),
    ),
  )
  it.effect("a rate-limited attempt is unclassified and close --abandoned works", () =>
    withHarness({ script: claudeRateLimited }, rateLimitedIsCloseOnly),
  )
})
