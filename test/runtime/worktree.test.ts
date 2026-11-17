// Creating the supervisor worktree against disposable repositories (design
// "Supervisor worktree", "Creation"; plan B11a). Each test makes its own
// repository in a temporary directory; nothing touches the global config.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { existsSync, mkdirSync } from "node:fs"
import { WorktreeCreated } from "../../src/domain/events.ts"
import { Revision } from "../../src/domain/ids.ts"
import { WorktreeBranchExists, WorktreePathExists } from "../../src/domain/worktree.ts"
import { createWorktree } from "../../src/runtime/worktree.ts"
import { emptyCommit, git, withRepo } from "./git-repo.ts"

const request = (owner: string, path: string) => ({
  ownerCheckout: owner,
  path,
  name: "t",
  start: Option.none(),
})

const ownerState = (owner: string) =>
  Effect.all({
    head: git(owner, "rev-parse", "HEAD"),
    branch: git(owner, "symbolic-ref", "HEAD"),
    status: git(owner, "status", "--porcelain"),
  })

const createdOnBranchLocked = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const base = yield* git(owner, "rev-parse", "HEAD")
    const created = yield* createWorktree(request(owner, `${dir}/worktree`))
    const top = yield* git(created.path, "rev-parse", "--show-toplevel")
    const commonDir = yield* git(owner, "rev-parse", "--absolute-git-dir")
    expect(Schema.is(WorktreeCreated)(created)).toBe(true)
    expect(created.path).toBe(top)
    expect(created.branch).toBe("foreman/t")
    expect(created.base).toBe(base)
    expect(created.commonDir).toBe(commonDir)
    expect(created.gitDir).toBe(`${commonDir}/worktrees/worktree`)
    const listing = yield* git(owner, "worktree", "list", "--porcelain")
    expect(listing).toContain(
      `worktree ${top}\nHEAD ${base}\nbranch refs/heads/foreman/t\nlocked foreman`,
    )
    expect(yield* git(created.path, "symbolic-ref", "HEAD")).toBe("refs/heads/foreman/t")
  })

const startsFromGivenRevision = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const start = yield* Schema.decodeUnknownEffect(Revision)(
      yield* git(owner, "rev-parse", "HEAD"),
    )
    yield* emptyCommit(owner, "second")
    const created = yield* createWorktree({
      ...request(owner, `${dir}/worktree`),
      start: Option.some(start),
    })
    expect(created.base).toBe(start)
    expect(yield* git(created.path, "rev-parse", "HEAD")).toBe(start)
  })

const existingBranchRefused = (dir: string, owner: string) =>
  Effect.gen(function* () {
    yield* git(owner, "branch", "foreman/t")
    const refused = yield* Effect.flip(createWorktree(request(owner, `${dir}/worktree`)))
    expect(refused).toEqual(new WorktreeBranchExists({ branch: "foreman/t" }))
    expect(existsSync(`${dir}/worktree`)).toBe(false)
  })

const existingPathRefused = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/worktree`
    mkdirSync(path)
    const refused = yield* Effect.flip(createWorktree(request(owner, path)))
    expect(refused).toEqual(new WorktreePathExists({ path }))
    const branches = yield* git(owner, "branch", "--list", "foreman/*")
    expect(branches).toBe("")
  })

const ownerUnchanged = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const before = yield* ownerState(owner)
    yield* createWorktree(request(owner, `${dir}/worktree`))
    const after = yield* ownerState(owner)
    expect(after).toEqual(before)
    expect(after.branch).toBe("refs/heads/main")
    expect(after.status).toBe("")
  })

describe("createWorktree", () => {
  it.effect("returns the created fields; the worktree is on its branch, locked", () => withRepo(createdOnBranchLocked))

  it.effect("starts from a given start revision instead of the owner's HEAD", () => withRepo(startsFromGivenRevision))

  it.effect("refuses an existing branch and creates no path", () => withRepo(existingBranchRefused))

  it.effect("refuses an existing path, even an empty directory, and creates no branch", () => withRepo(existingPathRefused))

  it.effect("leaves the owner's checkout unchanged", () => withRepo(ownerUnchanged))
})
