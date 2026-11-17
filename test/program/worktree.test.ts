// The startup check end to end (design "Supervisor worktree", "Startup
// check"; plan B11a): git lists the worktrees, Format decodes the listing
// and Features decides. Each test makes its own repository and worktree.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import type { WorktreeCreated } from "../../src/domain/events.ts"
import { WorktreeCheckFailed, WorktreeConditions } from "../../src/domain/worktree.ts"
import type { WorktreeCondition } from "../../src/domain/worktree.ts"
import { identifyWorktree } from "../../src/program/worktree.ts"
import { createWorktree } from "../../src/runtime/worktree.ts"
import { git, withRepo } from "../runtime/git-repo.ts"

const created = (dir: string, owner: string) =>
  createWorktree({ ownerCheckout: owner, path: `${dir}/worktree`, name: "t", start: Option.none() })

const failedWith =
  (worktree: WorktreeCreated) =>
  (...failed: [WorktreeCondition, ...Array<WorktreeCondition>]) =>
    new WorktreeCheckFailed({ path: worktree.path, branch: worktree.branch, failed })

const passesForCreated = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const worktree = yield* created(dir, owner)
    const entry = yield* identifyWorktree(worktree)
    expect(entry.path).toBe(worktree.path)
    expect(entry.branch).toEqual(Option.some("refs/heads/foreman/t"))
    expect(entry.lock).toEqual(Option.some({ reason: Option.some("foreman") }))
  })

const reportsUnlocked = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const worktree = yield* created(dir, owner)
    yield* git(owner, "worktree", "unlock", worktree.path)
    expect(yield* Effect.flip(identifyWorktree(worktree))).toEqual(
      failedWith(worktree)(WorktreeConditions.Locked),
    )
  })

const reportsOtherBranch = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const worktree = yield* created(dir, owner)
    yield* git(worktree.path, "switch", "--quiet", "-c", "other")
    expect(yield* Effect.flip(identifyWorktree(worktree))).toEqual(
      failedWith(worktree)(WorktreeConditions.OnBranch),
    )
  })

const reportsDetached = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const worktree = yield* created(dir, owner)
    yield* git(worktree.path, "switch", "--quiet", "--detach")
    expect(yield* Effect.flip(identifyWorktree(worktree))).toEqual(
      failedWith(worktree)(WorktreeConditions.OnBranch),
    )
  })

const reportsRetired = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const worktree = yield* created(dir, owner)
    yield* git(owner, "worktree", "unlock", worktree.path)
    yield* git(owner, "worktree", "remove", worktree.path)
    expect(yield* Effect.flip(identifyWorktree(worktree))).toEqual(
      failedWith(worktree)(WorktreeConditions.Listed),
    )
  })

describe("identifyWorktree (startup check)", () => {
  it.effect("passes for the created worktree", () => withRepo(passesForCreated))

  it.effect("reports an unlocked worktree", () => withRepo(reportsUnlocked))

  it.effect("reports a worktree switched to a different branch", () => withRepo(reportsOtherBranch))

  it.effect("reports a detached worktree as not on the branch", () => withRepo(reportsDetached))

  it.effect("reports a missing path after the owner retires the worktree", () => withRepo(reportsRetired))
})
