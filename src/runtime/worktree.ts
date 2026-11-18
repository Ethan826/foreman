// The supervisor worktree's git and file system effects (design
// "Supervisor worktree", "Creation" and "Startup check"; plan B11a and the
// owner's rulings on it): adding it from the owner's checkout, listing the
// worktrees for the startup check (the directory reading is in
// `worktree-directory.ts`).
// Runtime runs commands and returns their raw output; Format decodes and
// Features decides, and Program reads, decides and sequences (ruling 2 and
// the ruling on R2 of the B11a review). Git runs with
// the inherited environment; the clean environment and `-c` overrides are
// B11's `git.ts` and not applied here. The owner's checkout is only read.
import { Effect, Option } from "effect"
import { execFile, type ExecFileError } from "node:child_process"
import type { Revision } from "../domain/ids.ts"
import { GitCommandFailed, localBranchRef } from "../domain/worktree.ts"
import { realpathOf } from "./file-paths.ts"

/** What a finished git command printed and its exit code. */
export interface GitOutput {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

/**
 * Runs git with `args` in directory `cwd`. Succeeds with any exit code;
 * fails with {@link GitCommandFailed} only when git could not start or a
 * signal ended it. A test injects one to see or alter the commands.
 */
export type RunGit = (
  cwd: string,
  args: ReadonlyArray<string>,
) => Effect.Effect<GitOutput, GitCommandFailed>

/** What `git worktree add` is asked to make. */
export interface WorktreeAddition {
  /** The short branch name to create, `foreman/<name>`. */
  readonly branch: string
  /** The absolute path of the new worktree. */
  readonly path: string
  /** The revision the branch starts at. */
  readonly base: Revision
}

/** A finished command's output together with the args it ran with. */
export interface GitRun extends GitOutput {
  /** The args git ran with. */
  readonly args: ReadonlyArray<string>
}

/**
 * The raw reads taken in the new worktree after `git worktree add`, for
 * Program to decode and check. The four git reads are stdout with its
 * trailing newline; `resolvedPath` is `realpath` of the requested path,
 * not git output.
 */
export interface AddedReads {
  /** The requested path with symlinks resolved, read after the add. */
  readonly resolvedPath: string
  /** Raw stdout of `rev-parse --show-toplevel` in the new worktree. */
  readonly toplevel: string
  /** Raw stdout of `rev-parse --symbolic-full-name HEAD` in the new worktree. */
  readonly headRef: string
  /** Raw stdout of `rev-parse --absolute-git-dir` in the new worktree. */
  readonly gitDir: string
  /** Raw stdout of `rev-parse --path-format=absolute --git-common-dir` in the new worktree. */
  readonly commonDir: string
}

/** The lock reason `git worktree add --lock --reason` records. */
const lockReason = "foreman"

/** git's separator between options and positional arguments. */
const endOfOptions = "--"

/** Runs git through `execFile`, reading stdout and stderr as UTF-8. */
export const runGit: RunGit = (cwd, args) =>
  Effect.callback<GitOutput, GitCommandFailed>((resume) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      resume(outcome(args, error, stdout, stderr))
    })
  })

/**
 * The listing command for the startup check: porcelain, NUL-terminated
 * (owner ruling 4 on B11a), so a path holding a newline stays one value.
 */
export const worktreeListArgs = ["worktree", "list", "--porcelain", "-z"] as const

/**
 * The single-value `rev-parse` reads, one command each so no value is
 * split from another at a newline. The four path and ref reads resolve
 * symlinks (probed with git 2.50.1). `headRef` prints a full ref, or `HEAD`
 * when detached; `ownerHead` is the owner's HEAD revision for the base.
 */
export const revParseArgs = {
  gitDir: ["rev-parse", "--absolute-git-dir"],
  commonDir: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  toplevel: ["rev-parse", "--show-toplevel"],
  headRef: ["rev-parse", "--symbolic-full-name", "HEAD"],
  ownerHead: ["rev-parse", "HEAD"],
} as const

/**
 * The branch probe's command: `rev-parse --verify --quiet
 * refs/heads/<branch>`, which exits 0 when the ref exists and 1 when not.
 */
export const branchProbeArgs = (branch: string): ReadonlyArray<string> => [
  "rev-parse", "--verify", "--quiet", localBranchRef(branch),
]

/** The raw stdout of `git rev-parse HEAD` in the owner's checkout. */
export const readOwnerHeadWith = (run: RunGit) => (ownerCheckout: string) =>
  succeeded(run, ownerCheckout, revParseArgs.ownerHead)

/**
 * Runs the branch probe ({@link branchProbeArgs}) in the owner's checkout
 * and reports its output and exit code, whatever the exit code.
 */
export const probeBranchWith = (run: RunGit) => (ownerCheckout: string, branch: string) => {
  const args = branchProbeArgs(branch)
  return Effect.map(run(ownerCheckout, args), (output): GitRun => ({ args, ...output }))
}

/**
 * Runs `git worktree add --lock --reason foreman -b <branch> -- <path>
 * <base>` in the owner's checkout. The `--` keeps a path that starts with
 * `-` from reading as an option (git 2.50.1 accepts it there). A non-zero
 * exit fails with {@link GitCommandFailed} keeping args, exit code and
 * stderr. Nothing is checked first and nothing is cleaned up.
 */
export const addWorktreeWith = (run: RunGit) => (ownerCheckout: string, addition: WorktreeAddition) =>
  Effect.asVoid(succeeded(run, ownerCheckout, worktreeAddArgs(addition)))

/**
 * Takes the raw reads of {@link AddedReads} at `path`: its `realpath`,
 * then the four `rev-parse` commands run inside it, each required to exit 0.
 */
export const readAddedWith = (run: RunGit) =>
  Effect.fn("readAdded")(function* (path: string) {
    const resolvedPath = yield* realpathOf(path)
    const reads = yield* Effect.all({
      toplevel: succeeded(run, path, revParseArgs.toplevel),
      headRef: succeeded(run, path, revParseArgs.headRef),
      gitDir: succeeded(run, path, revParseArgs.gitDir),
      commonDir: succeeded(run, path, revParseArgs.commonDir),
    })
    return { resolvedPath, ...reads }
  })

/**
 * {@link listWorktrees} over an injected git runner: the text of `git
 * worktree list --porcelain -z` run in `cwd`, any directory of the
 * repository such as its common git directory.
 */
export const listWorktreesWith = (run: RunGit) => (cwd: string) =>
  succeeded(run, cwd, worktreeListArgs)

/** The text of `git worktree list --porcelain -z` run in `cwd`. */
export const listWorktrees = listWorktreesWith(runGit)

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

/** Runs git and requires exit 0; returns stdout. */
const succeeded = (run: RunGit, cwd: string, args: ReadonlyArray<string>) =>
  Effect.flatMap(run(cwd, args), (output) =>
    output.exitCode === 0
      ? Effect.succeed(output.stdout)
      : Effect.fail(
          new GitCommandFailed({ args, exitCode: Option.some(output.exitCode), stderr: output.stderr }),
        ),
  )

/** The args of `git worktree add`, with `--` before the positional path and base. */
const worktreeAddArgs = (addition: WorktreeAddition): ReadonlyArray<string> => [
  "worktree", "add", "--lock", "--reason", lockReason, "-b", addition.branch,
  endOfOptions, addition.path, addition.base,
]
