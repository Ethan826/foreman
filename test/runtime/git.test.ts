// The clean git runner (design "Git environment", E7; plan B11b). The
// process call is checked against real child processes: an executable
// named `git` that is `/usr/bin/env` prints exactly the environment it was
// given, and shows which PATH resolved it. The clean runner is checked
// with a recording process call beneath it.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { GitCommandFailed } from "../../src/domain/worktree.ts"
import { cleanGitWith, startGit, type GitInvocation, type StartGit } from "../../src/runtime/git.ts"

/** Runs `use` with a fresh temporary directory, removed afterwards. */
const withTemporaryDirectory = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/foreman-git-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

/** Makes `<dir>/bin/git` a link to `/usr/bin/env` and returns `<dir>/bin`. */
const envNamedGit = (dir: string) => {
  mkdirSync(`${dir}/bin`)
  symlinkSync("/usr/bin/env", `${dir}/bin/git`)
  return `${dir}/bin`
}

/** The non-empty lines of `env` output, sorted. */
const variables = (stdout: string) => stdout.split("\n").filter((line) => line !== "").sort()

const passesExactEnvironment = (dir: string) =>
  Effect.gen(function* () {
    const bin = envNamedGit(dir)
    const output = yield* startGit({ cwd: dir, args: [], env: { PATH: bin, ONLY: "this" } })
    expect(output.exitCode).toBe(0)
    expect(variables(output.stdout)).toEqual(["ONLY=this", `PATH=${bin}`])
  })

const notFoundOnGivenPath = (dir: string) =>
  Effect.gen(function* () {
    mkdirSync(`${dir}/empty`)
    const refused = yield* Effect.flip(startGit({ cwd: dir, args: ["--version"], env: { PATH: `${dir}/empty` } }))
    expect(Schema.is(GitCommandFailed)(refused)).toBe(true)
    expect(refused.exitCode).toEqual(Option.none())
    expect(refused.args).toEqual(["--version"])
  })

/** A process call that records each invocation and reports exit 0 with no output. */
const recordingStart =
  (calls: Array<GitInvocation>): StartGit =>
  (invocation) =>
    Effect.sync(() => {
      calls.push(invocation)
      return { exitCode: 0, stdout: "", stderr: "" }
    })

const cleanEnvironment = {
  PATH: "/usr/bin:/bin",
  HOME: "/injected/home",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_ATTR_SOURCE: "4b825dc642cb6eb9a060e54bf8d69288fbe24904",
}

const overrides = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false"]

describe("startGit", () => {
  it.effect("resolves git on the given PATH and passes exactly the given environment", () =>
    withTemporaryDirectory(passesExactEnvironment))

  it.effect("fails as not run when git is not on the given PATH, ignoring the parent's", () =>
    withTemporaryDirectory(notFoundOnGivenPath))
})

describe("cleanGitWith", () => {
  it.effect("runs each command with exactly the clean environment and the injected home", () =>
    Effect.gen(function* () {
      const calls: Array<GitInvocation> = []
      yield* cleanGitWith(recordingStart(calls))("/injected/home")("/repo", ["status", "--porcelain"])
      expect(calls).toEqual([{ cwd: "/repo", args: [...overrides, "status", "--porcelain"], env: cleanEnvironment }])
    }))

  it.effect("passes the process call's output through unchanged", () =>
    Effect.gen(function* () {
      const start: StartGit = () => Effect.succeed({ exitCode: 3, stdout: "out\n", stderr: "err\n" })
      const output = yield* cleanGitWith(start)("/injected/home")("/repo", ["status"])
      expect(output).toEqual({ exitCode: 3, stdout: "out\n", stderr: "err\n" })
    }))
})
