// The one-attempt waiver rule keeps the original cause of a stop (design
// "Waivers"; review item R01, focused review finding 1). A check that
// could not run, or a file that could not be read, is a failure: the
// attempt fails with that failure and every armed waiver stays armed. Only
// a judgment that the worktree or the recorded file is wrong is a
// refusal, which expires every armed waiver.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Exit, Option, Schema } from "effect"
import { unlinkSync } from "node:fs"
import { type Client, Clients } from "../../src/domain/clients.ts"
import { type ProjectEvent, SessionOpened, Waived, WaiverExpired } from "../../src/domain/events.ts"
import { WaiverId } from "../../src/domain/ids.ts"
import { GitCommandFailed } from "../../src/domain/worktree.ts"
import { correct } from "../../src/program/correct.ts"
import { implement } from "../../src/program/implement.ts"
import { type SessionContext, WorktreeUnready } from "../../src/program/session-context.ts"
import { StateFileFailed } from "../../src/runtime/state-files.ts"
import { afterFindings } from "./handoff-steps.ts"
import { eventsOf, type Harness, withHarness } from "./session-harness.ts"
import { append, opened, quotaHold } from "./session-steps.ts"

const waiverOf: Readonly<Record<Client, WaiverId>> = {
  [Clients.Claude]: WaiverId.make("w-claude"),
  [Clients.Codex]: WaiverId.make("w-codex"),
}

/** Arms `provider`'s waiver under its quota hold, as a command that stopped after batch W leaves it. */
const armed = (harness: Harness, provider: Client) =>
  append(harness, [quotaHold(provider), new Waived({ provider, waiverId: waiverOf[provider] })])

/** The `WaiverExpired` events in the log. */
const expiredOf = (harness: Harness) =>
  Effect.map(eventsOf(harness), (events) => Arr.filter(events, Schema.is(WaiverExpired)))

/** The open session's recorded task copy. */
const taskCopyOf = (harness: Harness) =>
  Effect.flatMap(eventsOf(harness), (events: ReadonlyArray<ProjectEvent>) =>
    Effect.fromOption(Option.map(Arr.findLast(events, Schema.is(SessionOpened)), (event) => event.taskPath)),
  )

/** The startup git failure production's check surfaces, unwrapped. */
const startupGitFailure = new GitCommandFailed({ args: ["worktree", "list"], exitCode: Option.none(), stderr: "injected" })

/** `harness`'s context with its worktree check replaced by `check`. */
const withCheck = (harness: Harness, check: SessionContext["capabilities"]["checkWorktree"]): SessionContext => ({
  ...harness.context,
  capabilities: { ...harness.context.capabilities, checkWorktree: check },
})

/** The reason of the injected read failure. */
const ioError = "EIO: i/o error, read"

/** An I/O error reading the file at `path`, by either read; every other path reads as usual. */
const unreadable = (harness: Harness, path: string): SessionContext => {
  const files = harness.context.capabilities.stateFiles
  const failed = Effect.fail(new StateFileFailed({ path, reason: ioError }))
  return {
    ...harness.context,
    capabilities: {
      ...harness.context.capabilities,
      stateFiles: {
        ...files,
        read: (read) => (read === path ? failed : files.read(read)),
        readIfPresent: (read) => (read === path ? failed : files.readIfPresent(read)),
      },
    },
  }
}

/** The typed failure `attempt` stopped with, if any. */
const stopOf = (attempt: Effect.Effect<unknown, unknown>) =>
  Effect.map(Effect.exit(attempt), (exit) => (Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined))

/** Runs `attempt`, which must fail with `expected`, and requires that no waiver expired and nothing launched. */
const keepsWaiver = (harness: Harness, attempt: Effect.Effect<unknown, unknown>, expected: object) =>
  Effect.gen(function* () {
    expect(yield* stopOf(attempt)).toMatchObject(expected)
    expect(yield* expiredOf(harness)).toEqual([])
    expect(harness.client.launches.length).toBe(0)
  })

/** Runs `attempt`, which must fail with `expected`, and requires that `provider`'s waiver expired. */
const expiresWaiver = (harness: Harness, provider: Client, attempt: Effect.Effect<unknown, unknown>, expected: object) =>
  Effect.gen(function* () {
    expect(yield* stopOf(attempt)).toMatchObject(expected)
    expect(yield* expiredOf(harness)).toEqual([new WaiverExpired({ waiverId: waiverOf[provider] })])
  })

const startupGitFails = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness, Clients.Claude)
    const attempt = implement(withCheck(harness, () => Effect.fail(startupGitFailure)), { waive: false })
    yield* keepsWaiver(harness, attempt, startupGitFailure)
  })

const worktreeJudged = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness, Clients.Claude)
    const refused = () => Effect.fail(new WorktreeUnready({ reason: "not locked" }))
    const attempt = implement(withCheck(harness, refused), { waive: false })
    yield* expiresWaiver(harness, Clients.Claude, attempt, { _tag: "CommandRefused" })
  })

const taskReadFails = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness, Clients.Claude)
    const attempt = implement(unreadable(harness, yield* taskCopyOf(harness)), { waive: false })
    yield* keepsWaiver(harness, attempt, { _tag: "StateFileFailed", reason: ioError })
  })

const taskCopyMissing = (harness: Harness) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* armed(harness, Clients.Claude)
    unlinkSync(yield* taskCopyOf(harness))
    const attempt = implement(harness.context, { waive: false })
    yield* expiresWaiver(harness, Clients.Claude, attempt, { _tag: "TaskFileChanged" })
  })

const findingsReadFails = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterFindings(harness)
    yield* armed(harness, Clients.Claude)
    const findingsFile = `${harness.dir}/findings.md`
    const attempt = correct(unreadable(harness, findingsFile), { findingsFile, waive: false, attest: true })
    expect(yield* stopOf(attempt)).toMatchObject({ _tag: "StateFileFailed", reason: ioError })
    expect(yield* expiredOf(harness)).toEqual([])
  })

const findingsMissing = (harness: Harness) =>
  Effect.gen(function* () {
    yield* afterFindings(harness)
    yield* armed(harness, Clients.Claude)
    const attempt = correct(harness.context, { findingsFile: `${harness.dir}/absent.md`, waive: false, attest: true })
    yield* expiresWaiver(harness, Clients.Claude, attempt, { _tag: "FindingsFileUnreadable" })
  })

describe("a check or read that could not run keeps the waiver and its own cause", () => {
  it.effect("a startup git failure surfaces as GitCommandFailed", () => withHarness({}, startupGitFails))
  it.effect("an I/O error reading the task copy surfaces as StateFileFailed", () => withHarness({}, taskReadFails))
  it.effect("an I/O error reading the findings file surfaces as StateFileFailed", () =>
    withHarness({ repository: true }, findingsReadFails),
  )
})

describe("a judgment that the worktree or a file is wrong still expires the waiver", () => {
  it.effect("a refused worktree check", () => withHarness({}, worktreeJudged))
  it.effect("a missing task copy", () => withHarness({}, taskCopyMissing))
  it.effect("a missing findings file", () => withHarness({ repository: true }, findingsMissing))
})
