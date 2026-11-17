// The supervisor worktree's git effects (design "Supervisor worktree",
// "Creation" and "Startup check"; plan B11a): creating it from the owner's
// checkout and listing the worktrees for the startup check. Git runs with
// the inherited environment; the clean environment and `-c` overrides are
// B11's `git.ts` and not applied here. The owner's checkout is only read.
import { Array as Arr, Effect, Option, Schema, String } from "effect"
import { execFile, type ExecFileError } from "node:child_process"
import { existsSync } from "node:fs"
import { WorktreeCreated } from "../domain/events.ts"
import { Revision } from "../domain/ids.ts"
import {
  GitCommandFailed,
  GitOutputUndecodable,
  WorktreeBranchExists,
  WorktreePathExists,
  localBranchRef,
  supervisorBranch,
} from "../domain/worktree.ts"

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

/** What creating the supervisor worktree needs (design "Creation"). */
export interface WorktreeRequest {
  /** The owner's checkout, read once for `rev-parse HEAD` and the branch check. */
  readonly ownerCheckout: string
  /** Where the worktree goes: `<stateDir>/worktree`, outside the owner's checkout. */
  readonly path: string
  /** The configured name; the branch is `foreman/<name>`. */
  readonly name: string
  /** The configured start revision; none means the owner's HEAD. */
  readonly start: Option.Option<Revision>
}

/** The lock reason `git worktree add --lock --reason` records. */
const lockReason = "foreman"

/** `rev-parse --verify --quiet`'s exit code when the ref does not exist. */
const refMissingExit = 1

/** An absolute path: it starts with `/`. */
const AbsolutePath = Schema.String.check(Schema.isStartingWith("/"))

/** The three lines of the creation `rev-parse`, each an absolute path. */
const CreatedLines = Schema.Tuple([AbsolutePath, AbsolutePath, AbsolutePath])

/** Runs git through `execFile`, reading stdout and stderr as UTF-8. */
export const runGit: RunGit = (cwd, args) =>
  Effect.callback<GitOutput, GitCommandFailed>((resume) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      resume(outcome(args, error, stdout, stderr))
    })
  })

/**
 * {@link createWorktree} over an injected git runner. Resolves the base,
 * refuses an existing branch or path (with no cleanup), runs `git worktree
 * add --lock --reason foreman -b foreman/<name> <path> <base>`, and
 * resolves the new worktree's git directories. `path` in the result is
 * git's own `--show-toplevel` for the new worktree, the absolute, symlink-free
 * form that `git worktree list` prints, so the startup check can compare
 * it exactly.
 */
export const createWorktreeWith = (run: RunGit) =>
  Effect.fn("createWorktree")(function* (request: WorktreeRequest) {
    const branch = supervisorBranch(request.name)
    const base = yield* resolveBase(run, request)
    yield* refuseExistingBranch(run, request.ownerCheckout, branch)
    yield* refuseExistingPath(request.path)
    yield* succeeded(run, request.ownerCheckout, [
      "worktree", "add", "--lock", "--reason", lockReason, "-b", branch, request.path, base,
    ])
    return yield* createdFields(run, request.path, branch, base)
  })

/**
 * Creates the supervisor worktree (design "Creation") and returns the
 * fields of `WorktreeCreated`. Fails with {@link WorktreeBranchExists} or
 * {@link WorktreePathExists} before running `worktree add`, and leaves
 * whatever exists in place.
 */
export const createWorktree = createWorktreeWith(runGit)

/**
 * {@link listWorktrees} over an injected git runner: the text of `git
 * worktree list --porcelain` run in `cwd`, any directory of the repository
 * such as its common git directory.
 */
export const listWorktreesWith = (run: RunGit) => (cwd: string) =>
  succeeded(run, cwd, ["worktree", "list", "--porcelain"])

/** The text of `git worktree list --porcelain` run in `cwd`. */
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

/** The start revision, or `git rev-parse HEAD` in the owner's checkout. */
const resolveBase = (run: RunGit, request: WorktreeRequest) =>
  Option.match(request.start, {
    onSome: (start) => Effect.succeed(start),
    onNone: () => ownerHead(run, request.ownerCheckout),
  })

/** `git rev-parse HEAD` in the owner's checkout, decoded as a {@link Revision}. */
const ownerHead = (run: RunGit, ownerCheckout: string) => {
  const args = ["rev-parse", "HEAD"]
  return Effect.flatMap(succeeded(run, ownerCheckout, args), (stdout) =>
    Effect.mapError(
      Schema.decodeUnknownEffect(Revision)(String.trim(stdout)),
      (issue) => new GitOutputUndecodable({ args, reason: issue.message }),
    ),
  )
}

/** Fails with {@link WorktreeBranchExists} when `refs/heads/<branch>` exists. */
const refuseExistingBranch = (run: RunGit, ownerCheckout: string, branch: string) => {
  const args = ["rev-parse", "--verify", "--quiet", localBranchRef(branch)]
  return Effect.flatMap(run(ownerCheckout, args), (output): Effect.Effect<
    void,
    WorktreeBranchExists | GitCommandFailed
  > => {
    if (output.exitCode === 0) return Effect.fail(new WorktreeBranchExists({ branch }))
    if (output.exitCode === refMissingExit) return Effect.void
    return Effect.fail(
      new GitCommandFailed({ args, exitCode: Option.some(output.exitCode), stderr: output.stderr }),
    )
  })
}

/** Fails with {@link WorktreePathExists} when anything exists at `path`. */
const refuseExistingPath = (path: string) =>
  Effect.flatMap(Effect.sync(() => existsSync(path)), (exists) =>
    exists ? Effect.fail(new WorktreePathExists({ path })) : Effect.void,
  )

/**
 * Resolves the new worktree's git directory, common directory and top
 * level in one `rev-parse`, and requires each to be an absolute path.
 */
const createdFields = (run: RunGit, path: string, branch: string, base: Revision) => {
  const args = ["rev-parse", "--absolute-git-dir", "--git-common-dir", "--show-toplevel"]
  return Effect.flatMap(succeeded(run, path, args), (stdout) =>
    Effect.mapError(
      Schema.decodeUnknownEffect(CreatedLines)(Arr.filter(String.split(stdout, "\n"), String.isNonEmpty)),
      (issue) => new GitOutputUndecodable({ args, reason: issue.message }),
    ).pipe(
      Effect.map(
        ([gitDir, commonDir, top]) => new WorktreeCreated({ path: top, branch, gitDir, commonDir, base }),
      ),
    ),
  )
}
