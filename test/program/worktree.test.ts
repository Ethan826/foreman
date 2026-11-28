// The startup check end to end (design "Supervisor worktree", "Startup
// check"; plan B11a and owner rulings 4 and 5 on it): git lists the
// worktrees, Runtime reads the directory, Format decodes and Features
// decides. Each test makes its own repository and worktree, and every git
// command runs through the clean runner (plan B11b).
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Result, Schema } from "effect"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { decodeWorktreeList } from "../../src/format/worktree-list.ts"
import { listWorktreesWith } from "../../src/runtime/worktree.ts"
import type { WorktreeCreated } from "../../src/domain/events.ts"
import { PathUnreadable, WorktreeCheckFailed, WorktreeConditions } from "../../src/domain/worktree.ts"
import type { WorktreeCondition } from "../../src/domain/worktree.ts"
import { worktreeProgram } from "../../src/program/worktree.ts"
import { cleanRun, emptyHome, git, repositoryMillis, withRepo, withUnsearchable } from "../runtime/git-repo.ts"

/** The production entry points over this file's empty home. */
const { createWorktree, identifyWorktree } = worktreeProgram(emptyHome)

const createdAt = (owner: string, path: string) =>
  createWorktree({ ownerCheckout: owner, path, name: "t", start: Option.none() })

const created = (dir: string, owner: string) => createdAt(owner, `${dir}/worktree`)

/** The recorded path's entry in a fresh `-z` listing, read from the common directory. */
const listedEntry = (worktree: WorktreeCreated) =>
  Effect.map(listWorktreesWith(cleanRun)(worktree.commonDir), (text) =>
    Result.map(decodeWorktreeList(text), (entries) => entries.find((entry) => entry.path === worktree.path)),
  )

const failedWith =
  (worktree: WorktreeCreated) =>
  (...failed: [WorktreeCondition, ...Array<WorktreeCondition>]) =>
    new WorktreeCheckFailed({ path: worktree.path, branch: worktree.branch, failed })

const passesForCreated = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const worktree = yield* created(dir, owner)
    const entry = yield* identifyWorktree(worktree)
    expect(entry.path).toBe(worktree.path)
    expect(entry.branch).toEqual(Option.some("refs/heads/tarlatan/t"))
    expect(entry.lock).toEqual(Option.some({ reason: Option.some("tarlatan") }))
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

const passesWithNewlineInPath = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const worktree = yield* createdAt(owner, `${dir}/work\ntree`)
    expect(worktree.path).toContain("\n")
    const entry = yield* identifyWorktree(worktree)
    expect(entry.path).toBe(worktree.path)
    expect(entry.branch).toEqual(Option.some("refs/heads/tarlatan/t"))
  })

const reportsDeletedDirectory = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const worktree = yield* created(dir, owner)
    rmSync(worktree.path, { recursive: true, force: true })
    expect(yield* Effect.flip(identifyWorktree(worktree))).toEqual(
      failedWith(worktree)(WorktreeConditions.Present),
    )
    const entry = yield* listedEntry(worktree)
    expect(Result.map(entry, (found) => found?.lock)).toEqual(
      Result.succeed(Option.some({ reason: Option.some("tarlatan") })),
    )
  })

const reportsUnrelatedDirectory = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const worktree = yield* created(dir, owner)
    rmSync(worktree.path, { recursive: true, force: true })
    mkdirSync(worktree.path)
    expect(yield* Effect.flip(identifyWorktree(worktree))).toEqual(
      failedWith(worktree)(WorktreeConditions.Identity),
    )
  })

const reportsOtherRepository = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const worktree = yield* created(dir, owner)
    rmSync(worktree.path, { recursive: true, force: true })
    yield* git(dir, "init", "--quiet", "-b", "tarlatan/t", worktree.path)
    expect(yield* Effect.flip(identifyWorktree(worktree))).toEqual(
      failedWith(worktree)(WorktreeConditions.Identity),
    )
  })

const reportsFileAtPath = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const worktree = yield* created(dir, owner)
    rmSync(worktree.path, { recursive: true, force: true })
    writeFileSync(worktree.path, "not a worktree")
    expect(yield* Effect.flip(identifyWorktree(worktree))).toEqual(
      failedWith(worktree)(WorktreeConditions.Present),
    )
  })

/** The path and reason of a `PathUnreadable` failure; none for any other failure. */
const unreadable = (failure: unknown) =>
  Schema.is(PathUnreadable)(failure)
    ? Option.some({ path: failure.path, reason: failure.reason })
    : Option.none()

const reportsUnreadableDirectory = (dir: string, owner: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/locked`)
    const worktree = yield* createdAt(owner, `${dir}/locked/worktree`)
    const refused = yield* withUnsearchable(`${dir}/locked`, Effect.flip(identifyWorktree(worktree)))
    expect(Option.map(unreadable(refused), (failure) => failure.path)).toEqual(Option.some(worktree.path))
    expect(Option.map(unreadable(refused), (failure) => failure.reason)).toEqual(
      Option.some(expect.stringContaining("EACCES")),
    )
  })

describe("identifyWorktree (startup check)", () => {
  it.effect("passes for the created worktree", () => withRepo(passesForCreated), repositoryMillis)

  it.effect("reports an unlocked worktree", () => withRepo(reportsUnlocked), repositoryMillis)

  it.effect("reports a worktree switched to a different branch", () => withRepo(reportsOtherBranch), repositoryMillis)

  it.effect("reports a detached worktree as not on the branch", () => withRepo(reportsDetached), repositoryMillis)

  it.effect("reports a missing path after the owner retires the worktree", () => withRepo(reportsRetired), repositoryMillis)

  it.effect("passes for a worktree whose path contains a newline", () => withRepo(passesWithNewlineInPath), repositoryMillis)

  it.effect("reports a deleted directory; the locked registration stays listed", () =>
    withRepo(reportsDeletedDirectory), repositoryMillis)

  it.effect("reports an unrelated directory at the path as the wrong identity", () =>
    withRepo(reportsUnrelatedDirectory), repositoryMillis)

  it.effect("reports another repository at the path as the wrong identity", () =>
    withRepo(reportsOtherRepository), repositoryMillis)

  it.effect("reports a file at the path as no directory present", () => withRepo(reportsFileAtPath), repositoryMillis)

  it.effect("fails with PathUnreadable, not directory-present, under an unsearchable parent", () =>
    withRepo(reportsUnreadableDirectory), repositoryMillis)
})
