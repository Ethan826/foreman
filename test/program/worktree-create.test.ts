// Creating the supervisor worktree against disposable repositories (design
// "Supervisor worktree", "Creation"; plan B11a and owner rulings 1 and 3 on
// it). Each test makes its own repository in a temporary directory;
// every git command, the tests' own included, runs through the clean
// runner (plan B11b, R8). The tests that wrap the runner are in
// `worktree-create-runner.test.ts`.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { existsSync, mkdirSync, realpathSync, symlinkSync } from "node:fs"
import { WorktreeCreated } from "../../src/domain/events.ts"
import { Revision } from "../../src/domain/ids.ts"
import { WorktreeBranchExists, WorktreePathExists } from "../../src/domain/worktree.ts"
import { worktreeProgram } from "../../src/program/worktree.ts"
import { emptyCommit, emptyHome, git, repositoryMillis, withRepo } from "../runtime/git-repo.ts"

/** The production entry points over this file's empty home. */
const { createWorktree, identifyWorktree } = worktreeProgram(emptyHome)

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
    expect(created.branch).toBe("tarlatan/t")
    expect(created.base).toBe(base)
    expect(created.commonDir).toBe(commonDir)
    expect(created.gitDir).toBe(`${commonDir}/worktrees/worktree`)
    const listing = yield* git(owner, "worktree", "list", "--porcelain")
    expect(listing).toContain(
      `worktree ${top}\nHEAD ${base}\nbranch refs/heads/tarlatan/t\nlocked tarlatan`,
    )
    expect(yield* git(created.path, "symbolic-ref", "HEAD")).toBe("refs/heads/tarlatan/t")
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
    yield* git(owner, "branch", "tarlatan/t")
    const refused = yield* Effect.flip(createWorktree(request(owner, `${dir}/worktree`)))
    expect(refused).toEqual(new WorktreeBranchExists({ branch: "tarlatan/t" }))
    expect(existsSync(`${dir}/worktree`)).toBe(false)
  })

const existingPathRefused = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/worktree`
    mkdirSync(path)
    const refused = yield* Effect.flip(createWorktree(request(owner, path)))
    expect(refused).toEqual(new WorktreePathExists({ path }))
    const branches = yield* git(owner, "branch", "--list", "tarlatan/*")
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

const createdWithNewline = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/work\ntree`
    const created = yield* createWorktree(request(owner, path))
    expect(created.path).toBe(realpathSync(path))
    expect(created.path).toContain("\n")
    expect(created.gitDir).toBe(yield* git(path, "rev-parse", "--absolute-git-dir"))
    expect(created.commonDir).toBe(yield* git(owner, "rev-parse", "--absolute-git-dir"))
    expect(yield* git(path, "symbolic-ref", "HEAD")).toBe("refs/heads/tarlatan/t")
  })

const createdThroughSymlink = (dir: string, owner: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/real`)
    symlinkSync(`${dir}/real`, `${dir}/link`)
    const created = yield* createWorktree(request(owner, `${dir}/link/worktree`))
    expect(created.path).toBe(realpathSync(`${dir}/real/worktree`))
    const entry = yield* identifyWorktree(created)
    expect(entry.path).toBe(created.path)
  })

describe("createWorktree", () => {
  it.effect("returns the created fields; the worktree is on its branch, locked", () =>
    withRepo(createdOnBranchLocked), repositoryMillis)

  it.effect("starts from a given start revision instead of the owner's HEAD", () =>
    withRepo(startsFromGivenRevision), repositoryMillis)

  it.effect("refuses an existing branch and creates no path", () => withRepo(existingBranchRefused), repositoryMillis)

  it.effect("refuses an existing path, even an empty directory, and creates no branch", () =>
    withRepo(existingPathRefused), repositoryMillis)

  it.effect("leaves the owner's checkout unchanged", () => withRepo(ownerUnchanged), repositoryMillis)

  it.effect("creates a worktree whose path contains a newline", () => withRepo(createdWithNewline), repositoryMillis)

  it.effect("records the path with symlinks resolved, and it passes the startup check", () =>
    withRepo(createdThroughSymlink), repositoryMillis)
})
