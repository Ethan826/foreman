// Creating the supervisor worktree against disposable repositories (design
// "Supervisor worktree", "Creation"; plan B11a and owner rulings 1 and 3 on
// it). Each test makes its own repository in a temporary directory;
// every git command, the tests' own included, runs through the clean
// runner (plan B11b, R8). Some tests wrap the clean runner to alter one
// command's output or to act just before one command runs.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { existsSync, mkdirSync, realpathSync, symlinkSync } from "node:fs"
import { WorktreeCreated } from "../../src/domain/events.ts"
import { Revision } from "../../src/domain/ids.ts"
import {
  GitCommandFailed,
  PathUnreadable,
  WorktreeBranchExists,
  WorktreeNotAsCreated,
  WorktreePathExists,
  WorktreePathNotAbsolute,
} from "../../src/domain/worktree.ts"
import { createWorktree, createWorktreeWith, identifyWorktree } from "../../src/program/worktree.ts"
import type { GitOutput, RunGit } from "../../src/runtime/git.ts"
import { revParseArgs } from "../../src/runtime/worktree.ts"
import { cleanRun, emptyCommit, emptyHome, git, withRepo, withUnsearchable } from "../runtime/git-repo.ts"

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
    const created = yield* createWorktree(emptyHome)(request(owner, `${dir}/worktree`))
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
    const created = yield* createWorktree(emptyHome)({
      ...request(owner, `${dir}/worktree`),
      start: Option.some(start),
    })
    expect(created.base).toBe(start)
    expect(yield* git(created.path, "rev-parse", "HEAD")).toBe(start)
  })

const existingBranchRefused = (dir: string, owner: string) =>
  Effect.gen(function* () {
    yield* git(owner, "branch", "foreman/t")
    const refused = yield* Effect.flip(createWorktree(emptyHome)(request(owner, `${dir}/worktree`)))
    expect(refused).toEqual(new WorktreeBranchExists({ branch: "foreman/t" }))
    expect(existsSync(`${dir}/worktree`)).toBe(false)
  })

const existingPathRefused = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/worktree`
    mkdirSync(path)
    const refused = yield* Effect.flip(createWorktree(emptyHome)(request(owner, path)))
    expect(refused).toEqual(new WorktreePathExists({ path }))
    const branches = yield* git(owner, "branch", "--list", "foreman/*")
    expect(branches).toBe("")
  })

const ownerUnchanged = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const before = yield* ownerState(owner)
    yield* createWorktree(emptyHome)(request(owner, `${dir}/worktree`))
    const after = yield* ownerState(owner)
    expect(after).toEqual(before)
    expect(after.branch).toBe("refs/heads/main")
    expect(after.status).toBe("")
  })

/** The clean runner, with the stdout of the command `args` replaced by `stdout`. */
const overriding =
  (args: ReadonlyArray<string>, stdout: string): RunGit =>
  (cwd, called) =>
    Effect.map(cleanRun(cwd, called), (output) =>
      called.join(" ") === args.join(" ") ? { ...output, stdout } : output,
    )

/**
 * The clean runner, which first creates `foreman/t` in `owner` when
 * `worktree add` is called, and keeps that command's args and output in
 * `added`.
 */
const racingBranch =
  (owner: string, added: Array<{ readonly args: ReadonlyArray<string>; readonly output: GitOutput }>): RunGit =>
  (cwd, called) =>
    called[0] === "worktree" && called[1] === "add"
      ? Effect.tap(Effect.andThen(cleanRun(owner, ["branch", "foreman/t"]), cleanRun(cwd, called)), (output) =>
          Effect.sync(() => {
            added.push({ args: called, output })
          }),
        )
      : cleanRun(cwd, called)

const createdWithNewline = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/work\ntree`
    const created = yield* createWorktree(emptyHome)(request(owner, path))
    expect(created.path).toBe(realpathSync(path))
    expect(created.path).toContain("\n")
    expect(created.gitDir).toBe(yield* git(path, "rev-parse", "--absolute-git-dir"))
    expect(created.commonDir).toBe(yield* git(owner, "rev-parse", "--absolute-git-dir"))
    expect(yield* git(path, "symbolic-ref", "HEAD")).toBe("refs/heads/foreman/t")
  })

const createdThroughSymlink = (dir: string, owner: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/real`)
    symlinkSync(`${dir}/real`, `${dir}/link`)
    const created = yield* createWorktree(emptyHome)(request(owner, `${dir}/link/worktree`))
    expect(created.path).toBe(realpathSync(`${dir}/real/worktree`))
    const entry = yield* identifyWorktree(emptyHome)(created)
    expect(entry.path).toBe(created.path)
  })

const refusesOtherToplevel = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/worktree`
    const create = createWorktreeWith(overriding(revParseArgs.toplevel, `${dir}\n`))
    const refused = yield* Effect.flip(create(request(owner, path)))
    expect(refused).toEqual(
      new WorktreeNotAsCreated({
        requestedPath: realpathSync(path),
        toplevel: dir,
        expectedRef: "refs/heads/foreman/t",
        headRef: "refs/heads/foreman/t",
      }),
    )
    expect(existsSync(path)).toBe(true)
  })

const refusesOtherHead = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/worktree`
    const create = createWorktreeWith(overriding(revParseArgs.headRef, "refs/heads/main\n"))
    const refused = yield* Effect.flip(create(request(owner, path)))
    expect(refused).toEqual(
      new WorktreeNotAsCreated({
        requestedPath: realpathSync(path),
        toplevel: realpathSync(path),
        expectedRef: "refs/heads/foreman/t",
        headRef: "refs/heads/main",
      }),
    )
  })

const raceKeepsGitDetails = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/worktree`
    const added: Array<{ readonly args: ReadonlyArray<string>; readonly output: GitOutput }> = []
    const refused = yield* Effect.flip(createWorktreeWith(racingBranch(owner, added))(request(owner, path)))
    expect(added.length).toBe(1)
    const ran = Option.fromNullishOr(added[0])
    const failed = Schema.is(GitCommandFailed)(refused) ? Option.some(refused) : Option.none()
    expect(Option.isSome(failed)).toBe(true)
    expect(Option.map(failed, (each) => each.args)).toEqual(Option.map(ran, (each) => each.args))
    expect(Option.map(failed, (each) => each.args.slice(0, 2))).toEqual(Option.some(["worktree", "add"]))
    expect(Option.map(failed, (each) => each.args.includes(path))).toEqual(Option.some(true))
    expect(Option.flatMap(failed, (each) => each.exitCode)).toEqual(Option.map(ran, (each) => each.output.exitCode))
    expect(Option.exists(Option.flatMap(failed, (each) => each.exitCode), (code) => code !== 0)).toBe(true)
    expect(Option.map(failed, (each) => each.stderr)).toEqual(Option.map(ran, (each) => each.output.stderr))
    expect(Option.exists(failed, (each) => each.stderr !== "")).toBe(true)
  })

/** The clean runner, which first appends each command's args to `calls`. */
const recording =
  (calls: Array<ReadonlyArray<string>>): RunGit =>
  (cwd, args) =>
    Effect.andThen(
      Effect.sync(() => {
        calls.push(args)
      }),
      cleanRun(cwd, args),
    )

/** Whether a recorded command is `git worktree add`. */
const isAdd = (args: ReadonlyArray<string>) => args[0] === "worktree" && args[1] === "add"

/** The path and reason of a `PathUnreadable` failure; none for any other failure. */
const unreadable = (failure: unknown) =>
  Schema.is(PathUnreadable)(failure)
    ? Option.some({ path: failure.path, reason: failure.reason })
    : Option.none()

const unreadablePathRefused = (dir: string, owner: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/locked`)
    const path = `${dir}/locked/worktree`
    const calls: Array<ReadonlyArray<string>> = []
    const create = createWorktreeWith(recording(calls))
    const refused = yield* withUnsearchable(`${dir}/locked`, Effect.flip(create(request(owner, path))))
    expect(Option.map(unreadable(refused), (failure) => failure.path)).toEqual(Option.some(path))
    expect(Option.map(unreadable(refused), (failure) => failure.reason)).toEqual(
      Option.some(expect.stringContaining("EACCES")),
    )
    expect(calls.filter(isAdd)).toEqual([])
    expect(existsSync(path)).toBe(false)
  })

const notAbsoluteRefused = (path: string) => (_dir: string, owner: string) =>
  Effect.gen(function* () {
    const calls: Array<ReadonlyArray<string>> = []
    const refused = yield* Effect.flip(createWorktreeWith(recording(calls))(request(owner, path)))
    expect(refused).toEqual(new WorktreePathNotAbsolute({ path }))
    expect(calls).toEqual([])
    expect(existsSync(`${owner}/${path}`)).toBe(false)
    expect(yield* git(owner, "branch", "--list", "foreman/*")).toBe("")
  })

const createdWithDashSegment = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/-worktree`
    const calls: Array<ReadonlyArray<string>> = []
    const created = yield* createWorktreeWith(recording(calls))(request(owner, path))
    expect(created.path).toBe(realpathSync(path))
    expect(yield* git(path, "symbolic-ref", "HEAD")).toBe("refs/heads/foreman/t")
    const added = calls.filter(isAdd)
    expect(added.map((args) => args.slice(-3, -1))).toEqual([["--", path]])
  })

describe("createWorktree", () => {
  it.effect("returns the created fields; the worktree is on its branch, locked", () => withRepo(createdOnBranchLocked))

  it.effect("starts from a given start revision instead of the owner's HEAD", () => withRepo(startsFromGivenRevision))

  it.effect("refuses an existing branch and creates no path", () => withRepo(existingBranchRefused))

  it.effect("refuses an existing path, even an empty directory, and creates no branch", () => withRepo(existingPathRefused))

  it.effect("leaves the owner's checkout unchanged", () => withRepo(ownerUnchanged))

  it.effect("creates a worktree whose path contains a newline", () => withRepo(createdWithNewline))

  it.effect("records the path with symlinks resolved, and it passes the startup check", () => withRepo(createdThroughSymlink))

  it.effect("fails when the top level is not the requested path, and leaves the worktree", () => withRepo(refusesOtherToplevel))

  it.effect("fails when HEAD is not refs/heads/foreman/<name>", () => withRepo(refusesOtherHead))

  it.effect("keeps git's args, exit code and stderr when a race defeats the branch precheck", () => withRepo(raceKeepsGitDetails))

  it.effect("fails with PathUnreadable under an unsearchable parent and never runs the add", () => withRepo(unreadablePathRefused))

  it.effect("refuses a relative path before running git", () => withRepo(notAbsoluteRefused("worktree")))

  it.effect("refuses a dash-prefixed path before running git", () => withRepo(notAbsoluteRefused("-worktree")))

  it.effect("creates an absolute path whose last segment starts with a dash, after --", () => withRepo(createdWithDashSegment))
})
