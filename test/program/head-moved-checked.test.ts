// A moved HEAD through production's startup check (`checkedHead`) beside
// an attribute check that did not pass (owner findings F2 and F3,
// dogfood-3a round 2). A HEAD read that fails keeps its own failure and
// the armed waiver, even beside attribute sources the check refused. An
// attribute source that could not be read after a successful HEAD read
// stops a launch with its own `AttributeSourcesUnread`, keeping the
// waiver, while `status` shows both the unread source and the moved HEAD.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Exit, Option, Schema } from "effect"
import { chmodSync, writeFileSync } from "node:fs"
import {
  AttributeRefusalReasons,
  AttributeSources,
  AttributeSourcesRefused,
  noAttributeAllowance,
} from "../../src/domain/attributes.ts"
import { Clients } from "../../src/domain/clients.ts"
import { Waived, WaiverExpired, WorktreeCreated } from "../../src/domain/events.ts"
import { Revision, WaiverId } from "../../src/domain/ids.ts"
import { HeadMoved } from "../../src/features/command-rules.ts"
import { handoffGitWith } from "../../src/program/handoff-git.ts"
import { implement } from "../../src/program/implement.ts"
import { checkedHead, type StartupGit } from "../../src/program/production.ts"
import type { CheckWorktree } from "../../src/program/session-context.ts"
import { status } from "../../src/program/status.ts"
import { worktreeProgramWith } from "../../src/program/worktree.ts"
import { startGit } from "../../src/runtime/git.ts"
import { emptyCommit, emptyHome, git } from "../runtime/git-repo.ts"
import { eventsOf, type Harness, repositoryHarnessMillis, withHarness } from "./session-harness.ts"
import { append, opened, quotaHold } from "./session-steps.ts"

/** The Claude waiver these tests arm. */
const waiverId = WaiverId.make("w-claude")

/** No permission bits: the file cannot be read. */
const unreadableMode = 0o000

/** Owner read and write; group and others read. */
const readableMode = 0o644

/** Opens a session and arms Claude's waiver under its quota hold. */
const openedAndArmed = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* append(harness, [quotaHold(Clients.Claude), new Waived({ provider: Clients.Claude, waiverId })])
  })

/** The `WaiverExpired` events in the log. */
const expiredOf = (harness: Harness) =>
  Effect.map(eventsOf(harness), (events) => Arr.filter(events, Schema.is(WaiverExpired)))

/** The typed failure `effect` stopped with, if any. */
const stopOf = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.map(Effect.exit(effect), (exit) => (Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined))

/** Production's startup check over real git, with `harness`'s directory as the state directory. */
const realStartup = (harness: Harness): StartupGit => ({
  worktree: worktreeProgramWith(startGit, noAttributeAllowance)(emptyHome),
  home: emptyHome,
  handoffGit: handoffGitWith(startGit, noAttributeAllowance)(emptyHome, harness.dir),
})

/** `harness`'s session and status contexts with `checkWorktree`. */
const contextsWith = (harness: Harness, checkWorktree: CheckWorktree) => ({
  context: { ...harness.context, capabilities: { ...harness.context.capabilities, checkWorktree } },
  statusContext: { ...harness.status, capabilities: { ...harness.status.capabilities, checkWorktree } },
})

/**
 * A startup check whose identification refuses the attribute sources and
 * whose HEAD read then fails, since the recorded worktree is moved to a
 * path where no repository exists.
 */
const refusedThenReadFails = (harness: Harness): CheckWorktree => {
  const startup = realStartup(harness)
  const refused = new AttributeSourcesRefused({
    revision: harness.base,
    refusals: [
      {
        source: AttributeSources.InfoAttributes,
        reason: AttributeRefusalReasons.Content,
        path: Option.some("info/attributes"),
        line: Option.some(1),
        detail: "* text",
      },
    ],
  })
  const worktree = { ...startup.worktree, identifyWorktree: () => Effect.fail(refused) }
  return (recorded, base) => {
    const absent = `${harness.dir}/absent`
    const elsewhere = new WorktreeCreated({
      path: absent,
      branch: recorded.branch,
      gitDir: `${absent}/.git`,
      commonDir: `${absent}/.git`,
      base: recorded.base,
    })
    return checkedHead({ ...startup, worktree }, elsewhere, base)
  }
}

const readFailureBesideRefusal = (harness: Harness) =>
  Effect.gen(function* () {
    yield* openedAndArmed(harness)
    const { context } = contextsWith(harness, refusedThenReadFails(harness))
    expect(yield* stopOf(implement(context, { waive: false }))).toMatchObject({ _tag: "GitCommandFailed" })
    expect(yield* expiredOf(harness)).toEqual([])
    expect(harness.client.launches.length).toBe(0)
  })

/** Runs `body` with the repository's `info/attributes` present but unreadable, restoring it afterwards. */
const withUnreadableInfo = <A, E>(harness: Harness, body: Effect.Effect<A, E>) => {
  const path = `${harness.worktree.commonDir}/info/attributes`
  return Effect.ensuring(
    Effect.andThen(
      Effect.sync(() => {
        writeFileSync(path, "")
        chmodSync(path, unreadableMode)
      }),
      body,
    ),
    Effect.sync(() => {
      chmodSync(path, readableMode)
    }),
  )
}

/** Opens a session, arms Claude's waiver and moves the real worktree's HEAD with an empty commit; returns the new HEAD. */
const movedAndArmed = (harness: Harness) =>
  Effect.gen(function* () {
    yield* openedAndArmed(harness)
    yield* emptyCommit(harness.worktree.path, "moved by the agent")
    return Revision.make(yield* git(harness.worktree.path, "rev-parse", "HEAD"))
  })

/** The real startup check's contexts for `harness`. */
const checkedContexts = (harness: Harness) =>
  contextsWith(harness, (recorded, base) => checkedHead(realStartup(harness), recorded, base))

const statusShowsUnreadAndMoved = (harness: Harness) =>
  Effect.gen(function* () {
    const head = yield* movedAndArmed(harness)
    const events = yield* eventsOf(harness)
    const report = yield* withUnreadableInfo(harness, status(checkedContexts(harness).statusContext))
    expect(report.worktree.passed).toBe(false)
    expect(report.worktree.detail).toContain("AttributeSourcesUnread")
    expect(report.headMoved).toEqual(Option.some(new HeadMoved({ base: harness.base, head })))
    expect(yield* eventsOf(harness)).toEqual(events)
  })

const launchStopsUnread = (harness: Harness) =>
  Effect.gen(function* () {
    yield* movedAndArmed(harness)
    const stop = yield* withUnreadableInfo(harness, stopOf(implement(checkedContexts(harness).context, { waive: false })))
    expect(stop).toMatchObject({ _tag: "AttributeSourcesUnread" })
    expect(yield* expiredOf(harness)).toEqual([])
    expect(harness.client.launches.length).toBe(0)
  })

describe("a failed HEAD read beside refused attribute sources", () => {
  it.effect("stops a launch with the read's failure and leaves an armed waiver armed", () =>
    withHarness({}, readFailureBesideRefusal),
  )
})

describe("a moved HEAD beside an attribute source that could not be read", () => {
  it.effect("status shows the unread source and the moved HEAD, and writes nothing", () =>
    withHarness({ repository: true }, statusShowsUnreadAndMoved), repositoryHarnessMillis,
  )
  it.effect("a launch stops with AttributeSourcesUnread and keeps the waiver", () =>
    withHarness({ repository: true }, launchStopsUnread), repositoryHarnessMillis,
  )
})
