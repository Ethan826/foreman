// The supervisor worktree's git and file system effects (design
// "Supervisor worktree", "Creation" and "Startup check"; plan B11a and the
// owner's rulings on it): adding it from the owner's checkout, listing the
// worktrees for the startup check (the directory reading is in
// `worktree-directory.ts`).
// Runtime runs commands and returns their raw output; Format decodes and
// Features decides, and Program reads, decides and sequences (ruling 2 and
// the ruling on R2 of the B11a review). Every command runs through an
// injected `RunGit`; production passes the clean runner of `git.ts` (plan
// B11b). The owner's checkout is only read.
import { Effect, Option } from "effect"
import type { Revision } from "../domain/ids.ts"
import { GitCommandFailed, localBranchRef } from "../domain/worktree.ts"
import { realpathOf } from "./file-paths.ts"
import type { GitOutput, RunGit } from "./git.ts"

/** What `git worktree add` is asked to make. */
export interface WorktreeAddition {
  /** The short branch name to create, `tarlatan/<name>`. */
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
const lockReason = "tarlatan"

/** git's separator between options and positional arguments. */
const endOfOptions = "--"

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
 * The raw stdout of `git rev-parse --path-format=absolute --git-common-dir`
 * in the owner's checkout, where the attribute check reads
 * `info/attributes` before the worktree exists (plan B11c).
 */
export const readOwnerCommonDirWith = (run: RunGit) => (ownerCheckout: string) =>
  succeeded(run, ownerCheckout, revParseArgs.commonDir)

/**
 * Runs the branch probe ({@link branchProbeArgs}) in the owner's checkout
 * and reports its output and exit code, whatever the exit code.
 */
export const probeBranchWith = (run: RunGit) => (ownerCheckout: string, branch: string) => {
  const args = branchProbeArgs(branch)
  return Effect.map(run(ownerCheckout, args), (output): GitRun => ({ args, ...output }))
}

/**
 * Runs `git worktree add --lock --reason tarlatan -b <branch> -- <path>
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
 * The text of `git worktree list --porcelain -z` run through `run` in
 * `cwd`, any directory of the repository such as its common git directory.
 */
export const listWorktreesWith = (run: RunGit) => (cwd: string) =>
  succeeded(run, cwd, worktreeListArgs)

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
