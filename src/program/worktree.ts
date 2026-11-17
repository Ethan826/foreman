// The supervisor worktree's creation and startup check (design "Supervisor
// worktree"; plan B11a and the owner's rulings on it): Runtime runs git
// and reads the file system, Format decodes the raw output and Features
// decides. Program only wires them (ruling 2). Creation lives here, not in
// Runtime, because it ends in a Features check and Runtime imports only
// Domain.
import { Effect, Option, Result } from "effect"
import { WorktreeCreated } from "../domain/events.ts"
import type { DirectoryReading, GitIdentity, WorktreeDirectory } from "../domain/worktree.ts"
import { GitOutputUndecodable } from "../domain/worktree.ts"
import { checkWorktree } from "../features/worktree-check.ts"
import { checkCreated } from "../features/worktree-created.ts"
import { decodeRevParseLine, decodeRevParsePath } from "../format/rev-parse.ts"
import { decodeWorktreeList } from "../format/worktree-list.ts"
import {
  addWorktreeWith,
  listWorktreesWith,
  revParseArgs,
  runGit,
  worktreeListArgs,
  type RunGit,
  type WorktreeRequest,
} from "../runtime/worktree.ts"
import { readDirectoryWith } from "../runtime/worktree-directory.ts"

/** A decoder of one command's output, as Format provides them. */
type OutputDecoder = (text: string) => Result.Result<string, { readonly message: string }>

/**
 * {@link createWorktree} over an injected git runner. Adds the worktree
 * (Runtime), decodes each read (Format), and checks that the top level is
 * the requested path with symlinks resolved and that HEAD is
 * `refs/heads/foreman/<name>` (Features). The recorded `path` is git's
 * top level, the form `git worktree list` prints.
 */
export const createWorktreeWith = (run: RunGit) =>
  Effect.fn("createWorktree")(function* (request: WorktreeRequest) {
    const added = yield* addWorktreeWith(run)(request)
    const found = yield* Effect.all({
      toplevel: decoded(decodeRevParsePath, added.toplevel, revParseArgs.toplevel),
      headRef: decoded(decodeRevParseLine, added.headRef, revParseArgs.headRef),
    })
    yield* Effect.fromResult(checkCreated(added, found))
    const identity = yield* identityOf(added)
    return new WorktreeCreated({
      path: found.toplevel,
      branch: added.branch,
      base: added.base,
      ...identity,
    })
  })

/**
 * Creates the supervisor worktree (design "Creation") and returns the
 * fields of `WorktreeCreated`. Fails with `WorktreeBranchExists` or
 * `WorktreePathExists` before running `worktree add`, with
 * `WorktreeNotAsCreated` when the new worktree is not at the requested
 * path on its branch, and with `GitCommandFailed` (args, exit code and
 * stderr) when a git command fails. Nothing is cleaned up on any failure.
 */
export const createWorktree = createWorktreeWith(runGit)

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
 * The startup check: succeeds with the recorded worktree's entry when
 * `git worktree list --porcelain -z` lists its path on
 * `refs/heads/<branch>`, locked, and the directory there is present with
 * the recorded git identity; otherwise fails with `WorktreeCheckFailed`
 * naming each failed condition, and `run` stops and reports. It never
 * prunes, unlocks or removes anything.
 */
export const identifyWorktree = identifyWorktreeWith(runGit)

/** One raw read decoded, or the typed failure naming its command. */
const decoded = (decode: OutputDecoder, text: string, args: ReadonlyArray<string>) =>
  Effect.fromResult(Result.mapError(decode(text), undecodable(args)))

/** The two identity reads decoded as absolute paths. */
const identityOf = (raw: { readonly gitDir: string; readonly commonDir: string }) =>
  Effect.all({
    gitDir: decoded(decodeRevParsePath, raw.gitDir, revParseArgs.gitDir),
    commonDir: decoded(decodeRevParsePath, raw.commonDir, revParseArgs.commonDir),
  })

/** The identity decoded into a directory reading's result. */
const withIdentity =
  (present: boolean) =>
  (identity: Option.Option<GitIdentity>): WorktreeDirectory => ({ present, identity })

/** The directory reading with its identity decoded, when it has one. */
const directoryOf = (reading: DirectoryReading) =>
  Effect.map(
    Effect.transposeOption(Option.map(reading.identity, identityOf)),
    withIdentity(reading.present),
  )

/** Output a decoder refused, as a typed failure naming the command. */
const undecodable = (args: ReadonlyArray<string>) => (issue: { readonly message: string }) =>
  new GitOutputUndecodable({ args, reason: issue.message })
