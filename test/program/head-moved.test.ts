// A moved HEAD in the session commands (owner ruling of 2026-11-23,
// dogfood-3a). While a session is open, a supervisor HEAD that differs
// from the session's base refuses the launches, from the startup check's
// HEAD read, and `session close --finished`, from its own narrow
// `git rev-parse HEAD`. A launch's refusal expires the armed waivers as
// any launch refusal does; a refused close leaves them armed (owner
// ruling, dogfood-3a round 1). A HEAD read that fails keeps its own
// failure and the waiver. A worktree judged unready keeps the HEAD it
// read, so a launch is refused for both and `status` shows both (owner
// finding F2). `reject` and `session close --abandoned` still run, and
// `status` reports the moved HEAD as a finding and writes nothing.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Exit, Option, Schema, String as Str } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { Waived, WaiverExpired } from "../../src/domain/events.ts"
import { Revision, WaiverId } from "../../src/domain/ids.ts"
import { CloseKinds } from "../../src/domain/session.ts"
import { GitOutputUndecodable } from "../../src/domain/worktree.ts"
import { HeadMoved } from "../../src/features/command-rules.ts"
import { implement } from "../../src/program/implement.ts"
import { type SessionContext, WorktreeUnready } from "../../src/program/session-context.ts"
import { closeSession } from "../../src/program/session.ts"
import { status } from "../../src/program/status.ts"
import { emptyCommit, git } from "../runtime/git-repo.ts"
import { attestedClose } from "./handoff-commands.ts"
import { afterClean, rejected } from "./handoff-steps.ts"
import { eventsOf, type Harness, repositoryHarnessMillis, withHarness } from "./session-harness.ts"
import { append, opened, quotaHold, refusedFor } from "./session-steps.ts"

/** A HEAD that is not the harness's base. */
const moved = Revision.make(Str.repeat(40)("f"))

/** The Claude waiver these tests arm. */
const waiverId = WaiverId.make("w-claude")

/** Arms Claude's waiver under its quota hold, as a command that stopped after batch W leaves it. */
const armed = (harness: Harness) =>
  append(harness, [quotaHold(Clients.Claude), new Waived({ provider: Clients.Claude, waiverId })])

/** The `WaiverExpired` events in the log. */
const expiredOf = (harness: Harness) =>
  Effect.map(eventsOf(harness), (events) => Arr.filter(events, Schema.is(WaiverExpired)))

/** `harness`'s context with a worktree check that passes and reports `head`. */
const reportingHead = (harness: Harness, head: Revision): SessionContext => ({
  ...harness.context,
  capabilities: { ...harness.context.capabilities, checkWorktree: () => Effect.succeed(head) },
})

/** The typed failure `effect` stopped with, if any. */
const stopOf = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.map(Effect.exit(effect), (exit) => (Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined))

/** Moves the real worktree's HEAD with an empty commit, keeping its tree, and returns the new HEAD. */
const movedHeadOf = (harness: Harness) =>
  Effect.gen(function* () {
    yield* emptyCommit(harness.worktree.path, "moved by the agent")
    return Revision.make(yield* git(harness.worktree.path, "rev-parse", "HEAD"))
  })

const launchRefused = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness)
    const attempt = implement(reportingHead(harness, moved), { waive: false })
    expect(yield* stopOf(attempt)).toMatchObject({
      _tag: "CommandRefused",
      reasons: [{ _tag: "HeadMoved", base: harness.base, head: moved }],
    })
    expect(yield* expiredOf(harness)).toEqual([new WaiverExpired({ waiverId })])
    expect(harness.client.launches.length).toBe(0)
  })

const launchReadFails = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness)
    const failure = new GitOutputUndecodable({ args: ["rev-parse", "HEAD"], reason: "injected" })
    const context = { ...harness.context, capabilities: { ...harness.context.capabilities, checkWorktree: () => Effect.fail(failure) } }
    expect(yield* stopOf(implement(context, { waive: false }))).toMatchObject({ _tag: "GitOutputUndecodable", reason: "injected" })
    expect(yield* expiredOf(harness)).toEqual([])
    expect(harness.client.launches.length).toBe(0)
  })

const finishRefused = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterClean(harness)
    const head = yield* movedHeadOf(harness)
    yield* refusedFor(harness, attestedClose(harness), ["HeadMoved"])
    expect(yield* stopOf(attestedClose(harness))).toMatchObject({ reasons: [{ _tag: "HeadMoved", base: harness.base, head }] })
  })

const finishRefusedKeepsWaiver = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterClean(harness)
    yield* armed(harness)
    yield* movedHeadOf(harness)
    yield* refusedFor(harness, attestedClose(harness), ["HeadMoved"])
    expect(yield* expiredOf(harness)).toEqual([])
  })

/** The worktree judged unready for its attribute sources, with the moved HEAD it read. */
const unreadyOnMoved = new WorktreeUnready({ reason: "attribute sources refused", head: Option.some(moved) })

/** `harness`'s context and status context with a worktree check that fails with {@link unreadyOnMoved}. */
const unreadyContexts = (harness: Harness) => {
  const checkWorktree = () => Effect.fail(unreadyOnMoved)
  return {
    context: { ...harness.context, capabilities: { ...harness.context.capabilities, checkWorktree } },
    statusContext: { ...harness.status, capabilities: { ...harness.status.capabilities, checkWorktree } },
  }
}

const launchRefusedForBoth = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    const { context } = unreadyContexts(harness)
    expect(yield* stopOf(implement(context, { waive: false }))).toMatchObject({
      _tag: "CommandRefused",
      reasons: [{ _tag: "WorktreeCheckFailed" }, { _tag: "HeadMoved", base: harness.base, head: moved }],
    })
    expect(harness.client.launches.length).toBe(0)
  })

const statusShowsBoth = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    const events = yield* eventsOf(harness)
    const report = yield* status(unreadyContexts(harness).statusContext)
    expect(report.worktree).toEqual({ passed: false, detail: "attribute sources refused" })
    expect(report.headMoved).toEqual(Option.some(new HeadMoved({ base: harness.base, head: moved })))
    expect(yield* eventsOf(harness)).toEqual(events)
  })

const finishReadFails = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterClean(harness)
    yield* armed(harness)
    const before = yield* eventsOf(harness)
    harness.inject.gitFails = Option.some((args) => args[0] === "rev-parse" && args[1] === "HEAD")
    expect(yield* stopOf(attestedClose(harness))).toMatchObject({ _tag: "GitCommandFailed", stderr: "injected" })
    expect(yield* eventsOf(harness)).toEqual(before)
    expect(yield* expiredOf(harness)).toEqual([])
  })

const exitsStillRun = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterClean(harness)
    yield* movedHeadOf(harness)
    yield* rejected(harness)
    yield* closeSession(harness.context, { how: CloseKinds.Abandoned, note: "" })
  })

const statusShowsFinding = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    const events = yield* eventsOf(harness)
    const statusContext = {
      ...harness.status,
      capabilities: { ...harness.status.capabilities, checkWorktree: () => Effect.succeed(moved) },
    }
    const report = yield* status(statusContext)
    expect(report.headMoved).toEqual(Option.some(new HeadMoved({ base: harness.base, head: moved })))
    expect(harness.trace).toEqual([])
    expect(yield* eventsOf(harness)).toEqual(events)
  })

const statusOnBase = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    expect((yield* status(harness.status)).headMoved).toEqual(Option.none())
  })

describe("a moved HEAD", () => {
  it.effect("refuses a launch and expires the armed waiver", () => withHarness({}, launchRefused))
  it.effect("refuses close --finished from its own HEAD read", () =>
    withHarness({ repository: true }, finishRefused), repositoryHarnessMillis)
  it.effect("refuses close --finished and leaves an armed waiver armed", () =>
    withHarness({ repository: true }, finishRefusedKeepsWaiver), repositoryHarnessMillis,
  )
  it.effect("refuses a launch beside an unready worktree, with both reasons", () => withHarness({}, launchRefusedForBoth))
  it.effect("is a status finding beside an unready worktree", () => withHarness({}, statusShowsBoth))
  it.effect("does not refuse reject or close --abandoned", () =>
    withHarness({ repository: true }, exitsStillRun), repositoryHarnessMillis)
  it.effect("is a status finding, and status writes nothing", () => withHarness({}, statusShowsFinding))
  it.effect("is no status finding while HEAD is the base", () => withHarness({}, statusOnBase))
})

describe("a HEAD read that fails keeps its own failure and the waiver", () => {
  it.effect("in a launch's startup check", () => withHarness({}, launchReadFails))
  it.effect("in close --finished", () => withHarness({ repository: true }, finishReadFails), repositoryHarnessMillis)
})
