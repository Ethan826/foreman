// The supervisor worktree's creation and startup check (design "Supervisor
// worktree"; plan B11a and the owner's rulings on it): Runtime runs git
// and reads the file system, Format decodes the raw output and Features
// decides. Program performs the reads, passes them to Format and Features,
// and sequences the prechecks, the add and the reads after it (ruling 2
// and the ruling on R2 of the B11a review). Creation lives here because it
// runs Features checks and Runtime imports only Domain. The production
// entry points run every git command through the clean runner (plan B11b).
import { Effect, Option, Result } from "effect"
import { WorktreeCreated } from "../domain/events.ts"
import type { Revision } from "../domain/ids.ts"
import type { WorktreeDirectory } from "../domain/worktree.ts"
import { GitOutputUndecodable, supervisorBranch } from "../domain/worktree.ts"
import { checkWorktree } from "../features/worktree-check.ts"
import { checkCreated } from "../features/worktree-created.ts"
import { refuseExistingBranch, refuseExistingPath, requireAbsolute } from "../features/worktree-precheck.ts"
import { decodeIdentityRun, decodeRevParseLine, decodeRevParsePath, decodeRevParseRevision } from "../format/rev-parse.ts"
import { decodeWorktreeList } from "../format/worktree-list.ts"
import { statOf } from "../runtime/file-paths.ts"
import { cleanGit, type GitOutput, type RunGit } from "../runtime/git.ts"
import {
  addWorktreeWith,
  listWorktreesWith,
  probeBranchWith,
  readAddedWith,
  readOwnerHeadWith,
  revParseArgs,
  worktreeListArgs,
} from "../runtime/worktree.ts"
import { readDirectoryWith, type DirectoryReading } from "../runtime/worktree-directory.ts"

/** What creating the supervisor worktree needs (design "Creation"). */
export interface WorktreeRequest {
  /** The owner's checkout, read once for `rev-parse HEAD` and the branch check. */
  readonly ownerCheckout: string
  /** Where the worktree goes: an absolute path, `<stateDir>/worktree`, outside the owner's checkout. */
  readonly path: string
  /** The configured name; the branch is `foreman/<name>`. */
  readonly name: string
  /** The configured start revision; none means the owner's HEAD. */
  readonly start: Option.Option<Revision>
}

/** A decoder of one command's output, as Format provides them. */
type OutputDecoder<Value> = (text: string) => Result.Result<Value, { readonly message: string }>

/**
 * {@link createWorktree} over an injected git runner. Requires an absolute
 * path before anything runs (Features), resolves the base (Runtime reads,
 * Format decodes), runs the branch and path prechecks (Runtime reads,
 * Features decides), adds the worktree (Runtime), decodes each read after
 * it (Format), and checks that the top level is the requested path with
 * symlinks resolved and that HEAD is `refs/heads/foreman/<name>`
 * (Features). The recorded `path` is git's top level, the form `git
 * worktree list` prints.
 */
export const createWorktreeWith = (run: RunGit) =>
  Effect.fn("createWorktree")(function* (request: WorktreeRequest) {
    const path = yield* Effect.fromResult(requireAbsolute(request.path))
    const branch = supervisorBranch(request.name)
    const base = yield* baseOf(run, request)
    const probe = yield* probeBranchWith(run)(request.ownerCheckout, branch)
    yield* Effect.fromResult(refuseExistingBranch(branch, probe))
    yield* Effect.fromResult(refuseExistingPath(path, yield* statOf(path)))
    yield* addWorktreeWith(run)(request.ownerCheckout, { branch, path, base })
    const added = yield* readAddedWith(run)(path)
    const found = yield* Effect.all({
      toplevel: decoded(decodeRevParsePath, added.toplevel, revParseArgs.toplevel),
      headRef: decoded(decodeRevParseLine, added.headRef, revParseArgs.headRef),
    })
    yield* Effect.fromResult(checkCreated({ resolvedPath: added.resolvedPath, branch }, found))
    const identity = yield* identityOf(added)
    return new WorktreeCreated({ path: found.toplevel, branch, base, ...identity })
  })

/**
 * Creates the supervisor worktree (design "Creation") and returns the
 * fields of `WorktreeCreated`. Every git command runs through the clean
 * runner with `home`, an empty directory the caller provides, as HOME.
 * Fails with `WorktreePathNotAbsolute` before any git command when the
 * path is not absolute; with
 * `WorktreeBranchExists` or `WorktreePathExists` before running `worktree
 * add`; with `PathUnreadable` when `stat` cannot inspect the path; with
 * `WorktreeNotAsCreated` when the new worktree is not at the requested
 * path on its branch; and with `GitCommandFailed` (args, exit code and
 * stderr) when a git command fails. The path is refused only if it exists
 * when the precheck runs: an empty directory that appears between the
 * precheck and the add may be accepted by git, and no lock prevents that.
 * A branch created in that window makes the add fail. Nothing is cleaned
 * up on any failure.
 */
export const createWorktree = (home: string) => createWorktreeWith(cleanGit(home))

/**
 * {@link identifyWorktree} over an injected git runner. Lists the worktrees
 * from the recorded common directory, so the check runs even when the
 * worktree's own path is gone, and reads the recorded path's directory.
 */
export const identifyWorktreeWith = (run: RunGit) =>
  Effect.fn("identifyWorktree")(function* (worktree: WorktreeCreated) {
    const text = yield* listWorktreesWith(run)(worktree.commonDir)
    const entries = yield* Effect.fromResult(
      Result.mapError(decodeWorktreeList(text), undecodable(worktreeListArgs)),
    )
    const reading = yield* readDirectoryWith(run)(worktree.path)
    const directory = yield* directoryOf(reading)
    return yield* Effect.fromResult(checkWorktree(worktree, entries, directory))
  })

/**
 * The startup check, with every git command run through the clean runner
 * with `home`, an empty directory the caller provides, as HOME. It
 * succeeds with the recorded worktree's entry when `git worktree list
 * --porcelain -z` lists its path on
 * `refs/heads/<branch>`, locked, and the directory there is present with
 * the recorded git identity; otherwise fails with `WorktreeCheckFailed`
 * naming each failed condition, and `run` stops and reports. Fails with
 * `PathUnreadable` when the recorded path cannot be inspected, and with
 * `WorktreeRecordInvalid` when a recorded field is empty. It never
 * prunes, unlocks or removes anything.
 */
export const identifyWorktree = (home: string) => identifyWorktreeWith(cleanGit(home))

/** The start revision, or the owner's `rev-parse HEAD` read and decoded. */
const baseOf = (run: RunGit, request: WorktreeRequest) =>
  Option.match(request.start, {
    onSome: (start) => Effect.succeed(start),
    onNone: () => ownerHead(run, request.ownerCheckout),
  })

/** `git rev-parse HEAD` in the owner's checkout (Runtime), decoded as a revision (Format). */
const ownerHead = (run: RunGit, ownerCheckout: string) =>
  Effect.flatMap(readOwnerHeadWith(run)(ownerCheckout), (text) =>
    decoded(decodeRevParseRevision, text, revParseArgs.ownerHead),
  )

/** One raw read decoded, or the typed failure naming its command. */
const decoded = <Value>(decode: OutputDecoder<Value>, text: string, args: ReadonlyArray<string>) =>
  Effect.fromResult(Result.mapError(decode(text), undecodable(args)))

/** The two identity reads decoded as absolute paths. */
const identityOf = (raw: { readonly gitDir: string; readonly commonDir: string }) =>
  Effect.all({
    gitDir: decoded(decodeRevParsePath, raw.gitDir, revParseArgs.gitDir),
    commonDir: decoded(decodeRevParsePath, raw.commonDir, revParseArgs.commonDir),
  })

/** The two identity runs decoded (Format), exit codes kept for Features to judge. */
const identityRunsOf = (runs: { readonly gitDir: GitOutput; readonly commonDir: GitOutput }) =>
  Effect.all({
    gitDir: Effect.fromResult(Result.mapError(decodeIdentityRun(runs.gitDir), undecodable(revParseArgs.gitDir))),
    commonDir: Effect.fromResult(
      Result.mapError(decodeIdentityRun(runs.commonDir), undecodable(revParseArgs.commonDir)),
    ),
  })

/** The raw directory reading with its identity runs decoded, `stat` passed through. */
const directoryOf = (reading: DirectoryReading) =>
  Effect.map(
    Effect.transposeOption(Option.map(reading.identity, identityRunsOf)),
    (identity): WorktreeDirectory => ({ stat: reading.stat, identity }),
  )

/** Output a decoder refused, as a typed failure naming the command. */
const undecodable = (args: ReadonlyArray<string>) => (issue: { readonly message: string }) =>
  new GitOutputUndecodable({ args, reason: issue.message })
