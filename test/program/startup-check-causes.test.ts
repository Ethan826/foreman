// The startup worktree check keeps a failure apart from a judgment (review
// item R01, focused review finding 1). Production's check surfaces a git
// command that could not run as `GitCommandFailed`, and only a judgment
// that the worktree is wrong as `WorktreeUnready`. `session open` stops
// with the failure itself, and `status` reports it beside the rest.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Exit, Option, Schema } from "effect"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { noAttributeAllowance } from "../../src/domain/attributes.ts"
import { WorktreeCreated } from "../../src/domain/events.ts"
import { GitCommandFailed } from "../../src/domain/worktree.ts"
import { handoffGitWith } from "../../src/program/handoff-git.ts"
import { checkedHead } from "../../src/program/production.ts"
import { type SessionContext, WorktreeUnready } from "../../src/program/session-context.ts"
import { status } from "../../src/program/status.ts"
import { worktreeProgramWith } from "../../src/program/worktree.ts"
import { startGit, type StartGit } from "../../src/runtime/git.ts"
import { emptyHome } from "../runtime/git-repo.ts"
import type { Harness } from "./session-harness.ts"
import { withHarness } from "./session-harness.ts"
import { madeUpWorktree, realWorktree } from "./session-worktree.ts"
import { open } from "./session-steps.ts"

/** A git that cannot be started at all. */
const unstartable: StartGit = (invocation) =>
  Effect.fail(new GitCommandFailed({ args: invocation.args, exitCode: Option.none(), stderr: "spawn git ENOENT" }))

/** Production's startup check over `start`, with git's HOME `emptyHome` and published files under `dir`. */
const startupCheck = (start: StartGit, dir: string) => ({
  worktree: worktreeProgramWith(start, noAttributeAllowance)(emptyHome),
  home: emptyHome,
  handoffGit: handoffGitWith(start, noAttributeAllowance)(emptyHome, dir),
})

/** The typed failure `effect` stopped with, if any. */
const stopOf = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.map(Effect.exit(effect), (exit) => (Exit.isFailure(exit) ? Option.getOrUndefined(Exit.findErrorOption(exit)) : undefined))

/** Runs `use` over a fresh temporary directory and removes it afterwards. */
const inDirectory = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/foreman-startup-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

/** The git failure an injected check fails with. */
const injected = new GitCommandFailed({ args: ["rev-parse", "HEAD"], exitCode: Option.none(), stderr: "injected" })

/** `harness`'s context with a worktree check that fails with `injected`. */
const failingCheck = (harness: Harness): SessionContext => ({
  ...harness.context,
  capabilities: { ...harness.context.capabilities, checkWorktree: () => Effect.fail(injected) },
})

const gitUnstartable = () =>
  inDirectory((dir) =>
    Effect.gen(function* () {
      const { worktree } = madeUpWorktree(dir)
      const stop = yield* stopOf(checkedHead(startupCheck(unstartable, dir), worktree, Option.none()))
      expect(stop).toMatchObject({ _tag: "GitCommandFailed", stderr: "spawn git ENOENT" })
    }),
  )

const worktreeNotListed = () =>
  inDirectory((dir) =>
    Effect.gen(function* () {
      const { worktree } = yield* realWorktree(dir)
      const { branch, gitDir, commonDir, base } = worktree
      const moved = new WorktreeCreated({ path: `${dir}/elsewhere`, branch, gitDir, commonDir, base })
      const stop = yield* stopOf(checkedHead(startupCheck(startGit, dir), moved, Option.none()))
      expect(stop).toMatchObject({ _tag: "WorktreeUnready" })
      expect(Schema.is(WorktreeUnready)(stop) ? stop.reason : "").toContain("WorktreeCheckFailed")
    }),
  )

const openStopsWithFailure = (harness: Harness) =>
  Effect.gen(function* () {
    const stop = yield* stopOf(open({ ...harness, context: failingCheck(harness) }))
    expect(stop).toBe(injected)
  })

const statusReportsFailure = (harness: Harness) =>
  Effect.gen(function* () {
    const capabilities = { ...harness.status.capabilities, checkWorktree: failingCheck(harness).capabilities.checkWorktree }
    const report = yield* status({ ...harness.status, capabilities })
    expect(report.worktree.passed).toBe(false)
    expect(report.worktree.detail).toContain("GitCommandFailed")
  })

describe("the startup worktree check keeps a failure apart from a judgment", () => {
  it.effect("git that cannot start surfaces as GitCommandFailed", gitUnstartable)
  it.effect("a recorded path git does not list is judged WorktreeUnready", worktreeNotListed)
  it.effect("session open stops with the check's own failure", () => withHarness({}, openStopsWithFailure))
  it.effect("status reports the check's failure and still answers", () => withHarness({}, statusReportsFailure))
})
