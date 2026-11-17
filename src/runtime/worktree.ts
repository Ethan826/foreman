// The supervisor worktree's git and file system effects (design
// "Supervisor worktree", "Creation" and "Startup check"; plan B11a and the
// owner's rulings on it): adding it from the owner's checkout, listing the
// worktrees for the startup check (the directory reading is in
// `worktree-directory.ts`).
// Runtime returns raw output; Format decodes and Features decides, wired
// in Program (ruling 2), since Runtime imports only Domain. Git runs with
// the inherited environment; the clean environment and `-c` overrides are
// B11's `git.ts` and not applied here. The owner's checkout is only read.
import { Effect, Option, Schema, String } from "effect"
import { execFile, type ExecFileError } from "node:child_process"
import { existsSync } from "node:fs"
import { Revision } from "../domain/ids.ts"
import {
  GitCommandFailed,
  GitOutputUndecodable,
  WorktreeBranchExists,
  WorktreePathExists,
  localBranchRef,
  supervisorBranch,
} from "../domain/worktree.ts"
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
 * split from another at a newline. All four resolve symlinks (probed with
 * git 2.50.1). `headRef` prints a full ref, or `HEAD` when detached.
 */
export const revParseArgs = {
  gitDir: ["rev-parse", "--absolute-git-dir"],
  commonDir: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
  toplevel: ["rev-parse", "--show-toplevel"],
  headRef: ["rev-parse", "--symbolic-full-name", "HEAD"],
} as const

/**
 * What `git worktree add` produced, as raw reads for Program to decode
 * and check. The four git reads are stdout with its trailing newline;
 * `resolvedPath` is `realpath` of the requested path, not git output.
 */
export interface AddedWorktree {
  /** The short branch name, `foreman/<name>`. */
  readonly branch: string
  /** The revision the branch was created at. */
  readonly base: Revision
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

/**
 * Adds the supervisor worktree over an injected git runner (design
 * "Creation"). Resolves the base, refuses an existing branch or path
 * (with no cleanup), runs `git worktree add --lock --reason foreman -b
 * foreman/<name> <path> <base>`, and then takes the raw reads of
 * {@link AddedWorktree}. A failed command keeps its args, exit code and
 * stderr in {@link GitCommandFailed}, including the add when a race
 * defeats the prechecks. Program decodes and checks the reads.
 */
export const addWorktreeWith = (run: RunGit) =>
  Effect.fn("addWorktree")(function* (request: WorktreeRequest) {
    const branch = supervisorBranch(request.name)
    const base = yield* resolveBase(run, request)
    yield* refuseExistingBranch(run, request.ownerCheckout, branch)
    yield* refuseExistingPath(request.path)
    yield* succeeded(run, request.ownerCheckout, [
      "worktree", "add", "--lock", "--reason", lockReason, "-b", branch, request.path, base,
    ])
    const resolvedPath = yield* realpathOf(request.path)
    const reads = yield* Effect.all({
      toplevel: succeeded(run, request.path, revParseArgs.toplevel),
      headRef: succeeded(run, request.path, revParseArgs.headRef),
      gitDir: succeeded(run, request.path, revParseArgs.gitDir),
      commonDir: succeeded(run, request.path, revParseArgs.commonDir),
    })
    return { branch, base, resolvedPath, ...reads }
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
