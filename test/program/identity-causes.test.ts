// An identity read that git could not complete keeps its own cause and
// the waiver (focused re-review finding 1; review item R01). Production's
// startup check runs the two identity `rev-parse` commands inside the
// recorded worktree. When one exits because git could not read the
// repository, such as on an I/O error, the launch stops with git's own
// failure and diagnostic, and every armed waiver stays armed. Only git's
// report that there is no repository at the path is a judgment, which
// becomes `WorktreeUnready` and expires the waiver.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Exit, Option, Schema } from "effect"
import { noAttributeAllowance } from "../../src/domain/attributes.ts"
import { Clients } from "../../src/domain/clients.ts"
import { Waived, WaiverExpired } from "../../src/domain/events.ts"
import { WaiverId } from "../../src/domain/ids.ts"
import { handoffGitWith } from "../../src/program/handoff-git.ts"
import { implement } from "../../src/program/implement.ts"
import { checkedHead } from "../../src/program/production.ts"
import type { SessionContext } from "../../src/program/session-context.ts"
import { worktreeProgramWith } from "../../src/program/worktree.ts"
import { startGit, type StartGit } from "../../src/runtime/git.ts"
import { emptyHome } from "../runtime/git-repo.ts"
import { eventsOf, type Harness, withHarness } from "./session-harness.ts"
import { append, opened, quotaHold } from "./session-steps.ts"

/** The armed waiver. */
const waiverId = WaiverId.make("w-claude")

/** git's diagnostic for a repository it could not read. */
const ioDiagnostic = "fatal: unable to read git directory: Input/output error\n"

/** git's diagnostic where it finds no repository at all. */
const noRepository = "fatal: not a git repository (or any of the parent directories): .git\n"

/** Real git, except that the command holding `flag` exits 128 with `stderr`. */
const exitingOn =
  (flag: string, stderr: string): StartGit =>
  (invocation) =>
    Arr.contains(invocation.args, flag) ? Effect.succeed({ exitCode: 128, stdout: "", stderr }) : startGit(invocation)

/** `harness`'s context with production's startup check run over `start`. */
const checkedOver = (harness: Harness, start: StartGit): SessionContext => {
  const git = {
    worktree: worktreeProgramWith(start, noAttributeAllowance)(emptyHome),
    home: emptyHome,
    handoffGit: handoffGitWith(start, noAttributeAllowance)(emptyHome, harness.dir),
  }
  return {
    ...harness.context,
    capabilities: { ...harness.context.capabilities, checkWorktree: (recorded, base) => checkedHead(git, recorded, base) },
  }
}

/** The typed failure `attempt` stopped with, if any. */
const stopOf = (attempt: Effect.Effect<unknown, unknown>) =>
  Effect.map(Effect.exit(attempt), (exit) => (Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined))

/** The `WaiverExpired` events in the log. */
const expiredOf = (harness: Harness) =>
  Effect.map(eventsOf(harness), (events) => Arr.filter(events, Schema.is(WaiverExpired)))

/** Opens a session and arms Claude's waiver under its quota hold, then runs `implement` over `start`. */
const implementOver = (harness: Harness, start: StartGit) =>
  Effect.gen(function* () {
    yield* opened(harness)
    yield* append(harness, [quotaHold(Clients.Claude), new Waived({ provider: Clients.Claude, waiverId })])
    return yield* stopOf(implement(checkedOver(harness, start), { waive: false }))
  })

/** An identity read that exits on an I/O error stops the launch with git's failure and keeps the waiver. */
const keepsWaiverOn = (flag: string) => (harness: Harness) =>
  Effect.gen(function* () {
    const stop = yield* implementOver(harness, exitingOn(flag, ioDiagnostic))
    expect(stop).toMatchObject({ _tag: "GitCommandFailed", exitCode: Option.some(128), stderr: ioDiagnostic })
    expect(Schema.is(Schema.Struct({ args: Schema.Array(Schema.String) }))(stop) && Arr.contains(stop.args, flag)).toBe(true)
    expect(yield* expiredOf(harness)).toEqual([])
    expect(harness.client.launches.length).toBe(0)
  })

const noRepositoryExpires = (harness: Harness) =>
  Effect.gen(function* () {
    const stop = yield* implementOver(harness, exitingOn("--absolute-git-dir", noRepository))
    expect(stop).toMatchObject({ _tag: "CommandRefused" })
    expect(yield* expiredOf(harness)).toEqual([new WaiverExpired({ waiverId })])
  })

describe("an identity read git could not complete keeps its cause and the waiver", () => {
  it.effect("an I/O error from --absolute-git-dir surfaces as GitCommandFailed", () =>
    withHarness({ repository: true }, keepsWaiverOn("--absolute-git-dir")),
  )
  it.effect("an I/O error from --git-common-dir surfaces as GitCommandFailed", () =>
    withHarness({ repository: true }, keepsWaiverOn("--git-common-dir")),
  )
  it.effect("git's report of no repository is still a judgment that expires the waiver", () =>
    withHarness({ repository: true }, noRepositoryExpires),
  )
})
