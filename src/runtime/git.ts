// The clean git command environment (design "Git environment", E7; plan
// B11b). Every git command foreman runs goes through `cleanGit`: the
// process gets exactly the five variables of {@link cleanGitEnvironment}
// and nothing from the parent, and the three `-c` overrides come before
// the command's own args. This is the one module that starts a process
// for git (`test/runtime/git-process-gate.test.ts`). The pinned
// `GIT_DIR`, `GIT_WORK_TREE` and `GIT_COMMON_DIR` for the supervisor's
// tree and `--no-verify` are not applied here (excluded from B11b).
import { Effect, Option } from "effect"
import { execFile, type ExecFileError } from "node:child_process"
import { GitCommandFailed } from "../domain/worktree.ts"

/** What a finished git command printed and its exit code. */
export interface GitOutput {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Runs git with `args` in directory `cwd`. Succeeds with any exit code;
 * fails with {@link GitCommandFailed} only when git could not start or a
 * signal ended it. Production builds it with {@link cleanGit}; a test
 * injects one to see or alter the commands.
 */
export type RunGit = (
  cwd: string,
  args: ReadonlyArray<string>,
) => Effect.Effect<GitOutput, GitCommandFailed>

/** One git process to start: its directory, its args and its whole environment. */
export interface GitInvocation {
  readonly cwd: string
  readonly args: ReadonlyArray<string>
  /** The child's entire environment; nothing else is inherited. */
  readonly env: Readonly<Record<string, string>>
}

/**
 * Starts git for one {@link GitInvocation} and reports how it ended, with
 * the same success and failure rules as {@link RunGit}.
 */
export type StartGit = (invocation: GitInvocation) => Effect.Effect<GitOutput, GitCommandFailed>

/**
 * git's empty tree. As `GIT_ATTR_SOURCE` it makes git read
 * `.gitattributes` from an empty tree, so no filter declared there runs
 * (design "Git probes", git 2.50.1).
 */
export const emptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbe24904"

/**
 * The `-c` overrides that precede every command: no hooks, no fsmonitor
 * and no signing program (design "Git environment").
 */
export const cleanGitOverrides = [
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "commit.gpgsign=false",
] as const

/**
 * The whole environment of every git command: `git` and the programs it
 * runs resolve from `/usr/bin:/bin`, `HOME` is the injected empty
 * directory, no system or global config is read, and attributes come
 * from the empty tree.
 */
export const cleanGitEnvironment = (home: string): Readonly<Record<string, string>> => ({
  PATH: "/usr/bin:/bin",
  HOME: home,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_ATTR_SOURCE: emptyTree,
})

/**
 * Starts `git` through `execFile` with exactly the invocation's
 * environment, reading stdout and stderr as UTF-8. Bun 1.3.6 resolves
 * `git` on the given environment's PATH, not the parent's (checked by
 * `test/runtime/git.test.ts`).
 */
export const startGit: StartGit = ({ cwd, args, env }) =>
  Effect.callback<GitOutput, GitCommandFailed>((resume) => {
    execFile("git", args, { cwd, env, encoding: "utf8" }, (error, stdout, stderr) => {
      resume(outcome(args, error, stdout, stderr))
    })
  })

/**
 * The clean runner over an injected process call: each command gets the
 * {@link cleanGitOverrides} before its args and runs with
 * {@link cleanGitEnvironment} for `home`. `home` is an empty directory
 * the caller provides; this runner neither chooses nor checks it.
 */
export const cleanGitWith = (start: StartGit) => (home: string): RunGit => {
  const env = cleanGitEnvironment(home)
  return (cwd, args) => start({ cwd, args: [...cleanGitOverrides, ...args], env })
}

/** The production git runner: {@link cleanGitWith} over {@link startGit}. */
export const cleanGit = cleanGitWith(startGit)

/** An `execFile` result as a {@link GitOutput}, or a failure when git did not exit. */
const outcome = (
  args: ReadonlyArray<string>,
  error: ExecFileError | null,
  stdout: string,
  stderr: string,
): Effect.Effect<GitOutput, GitCommandFailed> =>
  Option.match(exitCodeOf(error), {
    onNone: () => Effect.fail(notRun(args, error, stderr)),
    onSome: (exitCode) => Effect.succeed({ exitCode, stdout, stderr }),
  })

/** The exit code: 0 with no error, the error's numeric code, or none. */
const exitCodeOf = (error: ExecFileError | null): Option.Option<number> =>
  error === null
    ? Option.some(0)
    : Option.filter(Option.fromNullishOr(error.code), (code) => typeof code === "number")

/** The failure for a git that did not start or was ended by a signal. */
const notRun = (args: ReadonlyArray<string>, error: ExecFileError | null, stderr: string) =>
  new GitCommandFailed({
    args,
    exitCode: Option.none(),
    stderr: error === null ? stderr : `${error.message}\n${stderr}`,
  })
