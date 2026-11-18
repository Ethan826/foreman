// The prechecks before creating the supervisor worktree (design
// "Creation"; owner rulings on R2 and R3 of the B11a review): the
// destination must be absolute, `refs/heads/foreman/<name>` must not exist
// and nothing may be at the path. Pure and total over raw results that
// Program reads through Runtime. An existing path is refused only when
// this check runs; an empty directory that appears before `git worktree
// add` may still be accepted by git, and no lock prevents that (R6).
import { Option, Result, String } from "effect"
import type { PathStat } from "../domain/worktree.ts"
import {
  GitCommandFailed,
  WorktreeBranchExists,
  WorktreePathExists,
  WorktreePathNotAbsolute,
} from "../domain/worktree.ts"

/** What `rev-parse --verify --quiet refs/heads/<branch>` reported. */
export interface BranchProbe {
  /** The command's args, kept in a failure. */
  readonly args: ReadonlyArray<string>
  /** Its exit code. */
  readonly exitCode: number
  /** Its stderr, kept in a failure. */
  readonly stderr: string
}

/** The root that starts every absolute path. */
const root = "/"

/** `rev-parse --verify --quiet`'s exit code when the ref resolves. */
const refFoundExit = 0

/** `rev-parse --verify --quiet`'s exit code when the ref does not exist. */
const refMissingExit = 1

/**
 * Succeeds with `path` when it starts with `/`; otherwise fails with
 * {@link WorktreePathNotAbsolute}. A relative path would resolve against
 * the owner's checkout in git and against the process's directory in the
 * prechecks; a leading `-` would read as an option. Runs before any
 * precheck or git command.
 */
export const requireAbsolute = (path: string): Result.Result<string, WorktreePathNotAbsolute> =>
  String.startsWith(root)(path) ? Result.succeed(path) : Result.fail(new WorktreePathNotAbsolute({ path }))

/**
 * Decides the branch precheck from the probe's exit code: 0 (the ref
 * exists) fails with {@link WorktreeBranchExists}, 1 (missing) passes, and
 * any other exit fails with {@link GitCommandFailed} carrying the probe's
 * args, exit code and stderr.
 */
export const refuseExistingBranch = (
  branch: string,
  probe: BranchProbe,
): Result.Result<void, WorktreeBranchExists | GitCommandFailed> => {
  if (probe.exitCode === refFoundExit) return Result.fail(new WorktreeBranchExists({ branch }))
  if (probe.exitCode === refMissingExit) return Result.void
  return Result.fail(probeFailed(probe))
}

/**
 * Fails with {@link WorktreePathExists} when `stat` found anything at
 * `path`, a file or a directory, even an empty one; passes when nothing
 * is there.
 */
export const refuseExistingPath = (
  path: string,
  stat: PathStat,
): Result.Result<void, WorktreePathExists> =>
  Option.isSome(stat) ? Result.fail(new WorktreePathExists({ path })) : Result.void

/** The probe's unexpected exit as a failed git command. */
const probeFailed = (probe: BranchProbe) =>
  new GitCommandFailed({ args: probe.args, exitCode: Option.some(probe.exitCode), stderr: probe.stderr })
