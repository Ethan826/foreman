// The supervisor worktree's creation and startup check (design "Supervisor
// worktree"; plan B11a and the owner's rulings on it): Runtime runs git
// and reads the file system, Format decodes the raw output and Features
// decides. Program performs the reads, passes them to Format and Features,
// and sequences the prechecks, the add and the reads after it (ruling 2
// and the ruling on R2 of the B11a review). Creation lives here because it
// runs Features checks and Runtime imports only Domain. The production
// entry points, `worktreeProgram`, run every git command through the clean
// runner (plan B11b), and the startup attribute check through the runner
// pinned to the recorded worktree (plan B11d).
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
import { cleanGitWith, pinnedGitWith, startGit, type GitOutput, type PinGit, type RunGit, type StartGit } from "../runtime/git.ts"
import {
  addWorktreeWith,
  listWorktreesWith,
  probeBranchWith,
  readAddedWith,
  readOwnerCommonDirWith,
  readOwnerHeadWith,
  revParseArgs,
  worktreeListArgs,
} from "../runtime/worktree.ts"
import { readDirectoryWith, type DirectoryReading } from "../runtime/worktree-directory.ts"
import { checkAttributeSourcesWith } from "./attribute-sources.ts"

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

/**
 * The worktree entry points over one git runner, as
 * {@link worktreeProgramWith} builds them.
 */
export interface WorktreeProgram {
  /**
   * Creates the supervisor worktree (design "Creation") and returns the
   * fields of `WorktreeCreated`. Fails with `WorktreePathNotAbsolute`
   * before any git command when the path is not absolute; with
   * `AttributeSourcesRefused` when the base revision or the repository has
   * an attribute source that option A refuses, or the config holds any
   * conditional include (option R; plan B11c), checked in the owner's
   * checkout before the branch and path prechecks; with `WorktreeBranchExists` or
   * `WorktreePathExists` before running `worktree add`; with `PathUnreadable` when `stat` cannot inspect the
   * path; with `WorktreeNotAsCreated` when the new worktree is not at the
   * requested path on its branch; and with `GitCommandFailed` (args, exit
   * code and stderr) when a git command fails. The path is refused only if
   * it exists when the precheck runs: an empty directory that appears
   * between the precheck and the add may be accepted by git, and no lock
   * prevents that. A branch created in that window makes the add fail.
   * Nothing is cleaned up on any failure.
   */
  readonly createWorktree: ReturnType<typeof createWorktreeWith>
  /**
   * The startup check: succeeds with the recorded worktree's entry when
   * `git worktree list --porcelain -z` lists its path on
   * `refs/heads/<branch>`, locked, and the directory there is present with
   * the recorded git identity; otherwise fails with `WorktreeCheckFailed`
   * naming each failed condition, and `run` stops and reports. When those
   * hold, the attribute check runs inside the supervisor worktree, so its
   * `config.worktree` applies, with git pinned to the recorded `gitDir`,
   * `path` and `commonDir` (plan B11d), against the recorded `base` (plan B11c) and
   * fails with `AttributeSourcesRefused`, including for any conditional
   * include (option R); no working tree's `.gitattributes` is read. Fails with
   * `PathUnreadable` when the recorded path cannot be inspected, and with
   * `WorktreeRecordInvalid` when a recorded field is empty. It never
   * prunes, unlocks or removes anything.
   */
  readonly identifyWorktree: ReturnType<typeof identifyWorktreeWith>
}

/** A decoder of one command's output, as Format provides them. */
type OutputDecoder<Value> = (text: string) => Result.Result<Value, { readonly message: string }>

/**
 * {@link WorktreeProgram.createWorktree} over an injected git runner. Requires an absolute
 * path before anything runs (Features), resolves the base (Runtime reads,
 * Format decodes), runs the attribute check on the base and the owner's
 * repository (plan B11c), runs the branch and path prechecks (Runtime reads,
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
    const commonDir = yield* ownerCommonDir(run, request.ownerCheckout)
    yield* checkAttributeSourcesWith(run)({ cwd: request.ownerCheckout, commonDir }, base)
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
 * {@link WorktreeProgram.identifyWorktree} over an injected clean runner
 * `run` and pinned runner builder `pinTo`. Lists the worktrees from the
 * recorded common directory through `run`, so the check runs even when
 * the worktree's own path is gone, and reads the recorded path's
 * directory, its identity reads included, through `run` too, so a moved
 * `.git` file or another repository there is still seen. The attribute
 * check runs only after the worktree conditions pass, through
 * `pinTo(worktree)`: git is pinned to the recorded `gitDir`, `path` and
 * `commonDir` (plan B11d) and runs in the supervisor worktree, so its
 * `config.worktree` applies, against the recorded base.
 */
export const identifyWorktreeWith = (run: RunGit, pinTo: PinGit) =>
  Effect.fn("identifyWorktree")(function* (worktree: WorktreeCreated) {
    const text = yield* listWorktreesWith(run)(worktree.commonDir)
    const entries = yield* Effect.fromResult(
      Result.mapError(decodeWorktreeList(text), undecodable(worktreeListArgs)),
    )
    const reading = yield* readDirectoryWith(run)(worktree.path)
    const directory = yield* directoryOf(reading)
    const entry = yield* Effect.fromResult(checkWorktree(worktree, entries, directory))
    const site = { cwd: worktree.path, commonDir: worktree.commonDir }
    yield* checkAttributeSourcesWith(pinTo(worktree))(site, worktree.base)
    return entry
  })

/**
 * The worktree entry points over one process call and one `home`.
 * Creation and the startup check's listing, `stat` and identity reads run
 * through `cleanGitWith(start)(home)`; the startup attribute check runs
 * through `pinnedGitWith(start)(home)` for the recorded worktree (plan
 * B11d). `home` is an empty directory the caller creates and owns;
 * nothing here checks it.
 */
export const worktreeProgramWith =
  (start: StartGit) =>
  (home: string): WorktreeProgram => {
    const run = cleanGitWith(start)(home)
    const pinTo = pinnedGitWith(start)(home)
    return { createWorktree: createWorktreeWith(run), identifyWorktree: identifyWorktreeWith(run, pinTo) }
  }

/**
 * The production entry points: {@link worktreeProgramWith} over the real
 * process call, `startGit` (plan B11b).
 */
export const worktreeProgram = worktreeProgramWith(startGit)

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

/** The owner's common git directory (Runtime), decoded as an absolute path (Format). */
const ownerCommonDir = (run: RunGit, ownerCheckout: string) =>
  Effect.flatMap(readOwnerCommonDirWith(run)(ownerCheckout), (text) =>
    decoded(decodeRevParsePath, text, revParseArgs.commonDir),
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
