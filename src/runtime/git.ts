// The git command environments (design "Git environment", E7; plans B11b
// and B11d). Every git command foreman runs gets exactly the five
// variables of {@link cleanGitEnvironment} and nothing from the parent,
// and the three `-c` overrides come before the command's own args: through
// `cleanGitWith`, or through `pinnedGitWith`, which adds the recorded
// `GIT_DIR`, `GIT_WORK_TREE` and `GIT_COMMON_DIR` of one worktree, or
// through `snapshotGitWith`, which adds `GIT_INDEX_FILE` to that (plan A2,
// "Snapshot identity and raw checks"). This is the one module that starts a process for git
// (`test/runtime/git-process-gate.test.ts`). `--no-verify` is not applied
// here. git's stdout and stderr arrive as bytes and are decoded as strict
// UTF-8 (review finding B17): bytes that are not UTF-8 fail the run rather
// than turning into U+FFFD, which could collide with a genuine U+FFFD path.
import { Effect, Option } from "effect"
import { execFile, type ExecFileError } from "node:child_process"
import { GitCommandFailed } from "../domain/worktree.ts"
import { strictUtf8 } from "./strict-utf8.ts"

/** What a finished git command printed and its exit code. */
export interface GitOutput {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Runs git with `args` in directory `cwd`. Succeeds with any exit code;
 * fails with {@link GitCommandFailed} only when git could not start, a
 * signal ended it, or it printed bytes that are not UTF-8. Production builds it with {@link cleanGit}; a test
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
 * The `stderr` of the {@link GitCommandFailed} for a run that printed
 * bytes which are not UTF-8 (review finding B17).
 */
export const undecodableOutput = "git printed output that is not valid UTF-8"

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
 * environment, reading stdout and stderr as raw bytes and decoding each as
 * strict UTF-8, a leading byte order mark kept. Bytes that are not UTF-8
 * in either stream fail the run with {@link GitCommandFailed}, git's exit
 * code and {@link undecodableOutput}, before any caller sees a path or
 * content (review finding B17). Bun 1.3.6 resolves `git` on the given
 * environment's PATH, not the parent's (checked by
 * `test/runtime/git.test.ts`).
 */
export const startGit: StartGit = ({ cwd, args, env }) =>
  Effect.callback<GitOutput, GitCommandFailed>((resume) => {
    execFile("git", args, { cwd, env, encoding: "buffer" }, (error, stdout, stderr) => {
      resume(Effect.flatMap(outcome(args, error, stderr), decodedWith(args, stdout, stderr)))
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

/**
 * The git identity recorded for a worktree when it was created: its top
 * level, its own git directory and the repository's common directory,
 * each an absolute path. The names match the fields of `WorktreeCreated`,
 * so the record passes as it is.
 */
export interface RecordedGitIdentity {
  /** The worktree's top level; becomes `GIT_WORK_TREE`. */
  readonly path: string
  /** The worktree's own git directory; becomes `GIT_DIR`. */
  readonly gitDir: string
  /** The repository's common git directory; becomes `GIT_COMMON_DIR`. */
  readonly commonDir: string
}

/**
 * Builds the runner for one recorded identity. Program receives one from
 * {@link pinnedGitWith}; a test may inject another.
 */
export type PinGit = (identity: RecordedGitIdentity) => RunGit

/**
 * The environment of a pinned git command (design "Git environment", E7;
 * plan B11d): the five variables of {@link cleanGitEnvironment} and
 * exactly three more, `GIT_DIR`, `GIT_WORK_TREE` and `GIT_COMMON_DIR`,
 * taken from the recorded identity. git then takes the worktree's git
 * directory, the common directory's config and objects, and the work tree
 * from these values, not from the directory, a `.git` file, the
 * worktree's `commondir` file or `core.worktree`. Under git 2.50.1 refs
 * are still found through the `commondir` file (probed for plan B11d).
 */
export const pinnedGitEnvironment = (
  home: string,
  identity: RecordedGitIdentity,
): Readonly<Record<string, string>> => ({
  ...cleanGitEnvironment(home),
  GIT_DIR: identity.gitDir,
  GIT_WORK_TREE: identity.path,
  GIT_COMMON_DIR: identity.commonDir,
})

/**
 * The pinned runner over an injected process call: each command gets the
 * {@link cleanGitOverrides} before its args and runs with
 * {@link pinnedGitEnvironment} for `home` and the identity it is given.
 * The identity is the caller's record, not something this runner reads
 * or checks; a `rev-parse` run through it reports these values back and
 * so verifies nothing. Output and failures pass through as with
 * {@link cleanGitWith}.
 */
export const pinnedGitWith =
  (start: StartGit) =>
  (home: string): PinGit =>
  (identity) => {
    const env = pinnedGitEnvironment(home, identity)
    return (cwd, args) => start({ cwd, args: [...cleanGitOverrides, ...args], env })
  }

/**
 * Builds the snapshot runner for one temporary index file. Program
 * receives one from {@link snapshotGitWith}; a test may inject another.
 */
export type SnapshotGit = (indexFile: string) => RunGit

/**
 * The snapshot runner over an injected process call (plan "Snapshot
 * identity and raw checks"): the {@link pinnedGitWith} runner plus
 * `GIT_INDEX_FILE`, exactly nine variables, with the
 * {@link cleanGitOverrides} before each command's args. git's documented
 * `GIT_INDEX_FILE` makes `read-tree`, `add` and `write-tree` use
 * `indexFile` instead of the worktree's own index, which they never read
 * or write. `indexFile` is the caller's fresh path; this runner neither
 * makes nor checks it.
 */
export const snapshotGitWith =
  (start: StartGit) =>
  (home: string) =>
  (identity: RecordedGitIdentity): SnapshotGit =>
  (indexFile) => {
    const env = { ...pinnedGitEnvironment(home, identity), GIT_INDEX_FILE: indexFile }
    return (cwd, args) => start({ cwd, args: [...cleanGitOverrides, ...args], env })
  }

/** The exit code of an `execFile` result, or a failure when git did not exit. */
const outcome = (
  args: ReadonlyArray<string>,
  error: ExecFileError | null,
  stderr: Uint8Array,
): Effect.Effect<number, GitCommandFailed> =>
  Option.match(exitCodeOf(error), {
    onNone: () => Effect.fail(notRun(args, error, diagnostic(stderr))),
    onSome: Effect.succeed,
  })

/** The run's output with both streams decoded, or the undecodable failure with git's exit code. */
const decodedWith =
  (args: ReadonlyArray<string>, stdout: Uint8Array, stderr: Uint8Array) =>
  (exitCode: number): Effect.Effect<GitOutput, GitCommandFailed> =>
    Option.match(Option.all({ stdout: strictUtf8(stdout), stderr: strictUtf8(stderr) }), {
      onNone: () => Effect.fail(new GitCommandFailed({ args, exitCode: Option.some(exitCode), stderr: undecodableOutput })),
      onSome: (streams) => Effect.succeed({ exitCode, ...streams }),
    })

/** The stderr of a git that did not exit, or {@link undecodableOutput} when it is not UTF-8. */
const diagnostic = (stderr: Uint8Array): string => Option.getOrElse(strictUtf8(stderr), () => undecodableOutput)

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
