// The clean git runner (design "Git environment", E7; plan B11b). The
// process call is checked against real child processes: an executable
// named `git` that runs `/usr/bin/env` prints exactly the environment it
// was given, and shows which PATH resolved it. The clean and pinned runners
// are checked with a recording process call beneath them.
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option, Schema } from "effect"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { GitCommandFailed } from "../../src/domain/worktree.ts"
import { cleanGitWith, pinnedGitWith, startGit, type GitInvocation, type StartGit } from "../../src/runtime/git.ts"

/** Runs `use` with a fresh temporary directory, removed afterwards. */
const withTemporaryDirectory = <A, E>(use: (dir: string) => Effect.Effect<A, E>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => mkdtempSync(`${tmpdir()}/tarlatan-git-`)),
    use,
    (dir) =>
      Effect.sync(() => {
        rmSync(dir, { recursive: true, force: true })
      }),
  )

/**
 * A `git` script that prints its environment. It must not be a link to
 * `/usr/bin/env`: on ubuntu-26.04, `env` is a link to the uutils multi-call
 * binary, which picks its tool by the name it was run as and exits 1 for
 * `git` (CI run 44537828893). The script runs `env` by its own path and
 * has it drop only `PWD` and `SHLVL`, which `/bin/sh` itself adds (bash
 * re-exports `SHLVL` on `exec` even after `unset`). An inherited copy of
 * those two is the one leak this check cannot see.
 */
const envScript = "#!/bin/sh\nexec /usr/bin/env -u PWD -u SHLVL\n"

/**
 * The time budget, in milliseconds, of the tests that start a process
 * through `startGit` (dogfood-6e, owner ruling of 2026-11-27). They claim
 * nothing about speed; a process start took seconds while other sessions
 * kept the load average between 75 and 200.
 *
 * What it bounds: the longer test starts one `sh` script named `git`,
 * which runs `env`; the other tries one start that finds nothing on its
 * PATH. Idle duration: awaiting the coordinator's measurement on the
 * dogfood-6f snapshot; this file is not among the measurements of
 * 2026-11-28.
 */
const gitStartMillis = 15_000

/** Writes `<dir>/bin/git` as {@link envScript} and returns `<dir>/bin`. */
const envNamedGit = (dir: string) => {
  mkdirSync(`${dir}/bin`)
  writeFileSync(`${dir}/bin/git`, envScript)
  chmodSync(`${dir}/bin/git`, 0o755)
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
    withTemporaryDirectory(passesExactEnvironment), gitStartMillis)

  it.effect("fails as not run when git is not on the given PATH, ignoring the parent's", () =>
    withTemporaryDirectory(notFoundOnGivenPath), gitStartMillis)
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

/** A recorded identity whose three values differ from each other and from every clean value. */
const recorded = {
  path: "/state/worktree",
  gitDir: "/owner/.git/worktrees/worktree",
  commonDir: "/owner/.git",
}

describe("pinnedGitWith", () => {
  it.effect("runs each command with exactly the five clean variables and the three recorded ones", () =>
    Effect.gen(function* () {
      const calls: Array<GitInvocation> = []
      const run = pinnedGitWith(recordingStart(calls))("/injected/home")(recorded)
      yield* run("/state/worktree", ["config", "--get", "core.attributesFile"])
      expect(calls).toEqual([
        {
          cwd: "/state/worktree",
          args: [...overrides, "config", "--get", "core.attributesFile"],
          env: {
            PATH: "/usr/bin:/bin",
            HOME: "/injected/home",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_ATTR_SOURCE: "4b825dc642cb6eb9a060e54bf8d69288fbe24904",
            GIT_DIR: "/owner/.git/worktrees/worktree",
            GIT_WORK_TREE: "/state/worktree",
            GIT_COMMON_DIR: "/owner/.git",
          },
        },
      ])
    }))

  it.effect("passes the process call's output through unchanged", () =>
    Effect.gen(function* () {
      const start: StartGit = () => Effect.succeed({ exitCode: 3, stdout: "out\n", stderr: "err\n" })
      const output = yield* pinnedGitWith(start)("/injected/home")(recorded)("/state/worktree", ["status"])
      expect(output).toEqual({ exitCode: 3, stdout: "out\n", stderr: "err\n" })
    }))

  it.effect("passes the process call's failure through unchanged", () =>
    Effect.gen(function* () {
      const failure = new GitCommandFailed({ args: ["status"], exitCode: Option.none(), stderr: "killed\n" })
      const start: StartGit = () => Effect.fail(failure)
      const refused = yield* Effect.flip(pinnedGitWith(start)("/injected/home")(recorded)("/state/worktree", ["status"]))
      expect(refused).toBe(failure)
    }))
})
