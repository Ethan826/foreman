// Creating the supervisor worktree with an injected runner (design
// "Supervisor worktree", "Creation"; plan B11a and owner rulings 1 and 3
// on it): each test wraps the clean runner (plan B11b, R8) to alter one
// command's output, to act just before one command runs, or to record the
// commands. Each test makes its own repository in a temporary directory.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { existsSync, mkdirSync, realpathSync } from "node:fs"
import { noAttributeAllowance } from "../../src/domain/attributes.ts"
import { GitCommandFailed, PathUnreadable, WorktreeNotAsCreated, WorktreePathNotAbsolute } from "../../src/domain/worktree.ts"
import { createWorktreeWith } from "../../src/program/worktree.ts"
import type { GitOutput, RunGit } from "../../src/runtime/git.ts"
import { revParseArgs } from "../../src/runtime/worktree.ts"
import { cleanRun, git, repositoryMillis, withRepo, withUnsearchable } from "../runtime/git-repo.ts"

const request = (owner: string, path: string) => ({
  ownerCheckout: owner,
  path,
  name: "t",
  start: Option.none(),
})

/** The clean runner, with the stdout of the command `args` replaced by `stdout`. */
const overriding =
  (args: ReadonlyArray<string>, stdout: string): RunGit =>
  (cwd, called) =>
    Effect.map(cleanRun(cwd, called), (output) =>
      called.join(" ") === args.join(" ") ? { ...output, stdout } : output,
    )

/**
 * The clean runner, which first creates `tarlatan/t` in `owner` when
 * `worktree add` is called, and keeps that command's args and output in
 * `added`.
 */
const racingBranch =
  (owner: string, added: Array<{ readonly args: ReadonlyArray<string>; readonly output: GitOutput }>): RunGit =>
  (cwd, called) =>
    called[0] === "worktree" && called[1] === "add"
      ? Effect.tap(Effect.andThen(cleanRun(owner, ["branch", "tarlatan/t"]), cleanRun(cwd, called)), (output) =>
          Effect.sync(() => {
            added.push({ args: called, output })
          }),
        )
      : cleanRun(cwd, called)


const refusesOtherToplevel = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/worktree`
    const create = createWorktreeWith(overriding(revParseArgs.toplevel, `${dir}\n`), noAttributeAllowance)
    const refused = yield* Effect.flip(create(request(owner, path)))
    expect(refused).toEqual(
      new WorktreeNotAsCreated({
        requestedPath: realpathSync(path),
        toplevel: dir,
        expectedRef: "refs/heads/tarlatan/t",
        headRef: "refs/heads/tarlatan/t",
      }),
    )
    expect(existsSync(path)).toBe(true)
  })

const refusesOtherHead = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/worktree`
    const create = createWorktreeWith(overriding(revParseArgs.headRef, "refs/heads/main\n"), noAttributeAllowance)
    const refused = yield* Effect.flip(create(request(owner, path)))
    expect(refused).toEqual(
      new WorktreeNotAsCreated({
        requestedPath: realpathSync(path),
        toplevel: realpathSync(path),
        expectedRef: "refs/heads/tarlatan/t",
        headRef: "refs/heads/main",
      }),
    )
  })

const raceKeepsGitDetails = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/worktree`
    const added: Array<{ readonly args: ReadonlyArray<string>; readonly output: GitOutput }> = []
    const refused = yield* Effect.flip(createWorktreeWith(racingBranch(owner, added), noAttributeAllowance)(request(owner, path)))
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
    const create = createWorktreeWith(recording(calls), noAttributeAllowance)
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
    const refused = yield* Effect.flip(createWorktreeWith(recording(calls), noAttributeAllowance)(request(owner, path)))
    expect(refused).toEqual(new WorktreePathNotAbsolute({ path }))
    expect(calls).toEqual([])
    expect(existsSync(`${owner}/${path}`)).toBe(false)
    expect(yield* git(owner, "branch", "--list", "tarlatan/*")).toBe("")
  })

const createdWithDashSegment = (dir: string, owner: string) =>
  Effect.gen(function* () {
    const path = `${dir}/-worktree`
    const calls: Array<ReadonlyArray<string>> = []
    const created = yield* createWorktreeWith(recording(calls), noAttributeAllowance)(request(owner, path))
    expect(created.path).toBe(realpathSync(path))
    expect(yield* git(path, "symbolic-ref", "HEAD")).toBe("refs/heads/tarlatan/t")
    const added = calls.filter(isAdd)
    expect(added.map((args) => args.slice(-3, -1))).toEqual([["--", path]])
  })

describe("createWorktree over an injected runner", () => {
  it.effect("fails when the top level is not the requested path, and leaves the worktree", () =>
    withRepo(refusesOtherToplevel), repositoryMillis)

  it.effect("fails when HEAD is not refs/heads/tarlatan/<name>", () => withRepo(refusesOtherHead), repositoryMillis)

  it.effect("keeps git's args, exit code and stderr when a race defeats the branch precheck", () =>
    withRepo(raceKeepsGitDetails), repositoryMillis)

  it.effect("fails with PathUnreadable under an unsearchable parent and never runs the add", () =>
    withRepo(unreadablePathRefused), repositoryMillis)

  it.effect("refuses a relative path before running git", () => withRepo(notAbsoluteRefused("worktree")), repositoryMillis)

  it.effect("refuses a dash-prefixed path before running git", () =>
    withRepo(notAbsoluteRefused("-worktree")), repositoryMillis)

  it.effect("creates an absolute path whose last segment starts with a dash, after --", () =>
    withRepo(createdWithDashSegment), repositoryMillis)
})
