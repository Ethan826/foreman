// The snapshot's Runtime pieces (plan A2, "Snapshot identity and raw
// checks"): its git commands, the preflight's among them (review finding
// B08), the fresh temporary index file in the state directory, and the
// platform SHA-1 that Format's blob id frames. Every
// command runs through the snapshot runner of `git.ts`, which points
// `GIT_INDEX_FILE` at the temporary index, so the worktree's own index is
// never read or written and no ref moves.
import { Array as Arr, Effect, Predicate } from "effect"
import { createHash, type Hash } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import type { Revision } from "../domain/ids.ts"
import { SnapshotIndexFailed } from "../domain/snapshot.ts"

/** The reason recorded when a thrown value carries no message. */
const unknownReason = "unknown error"

/**
 * The snapshot's commands, in the order Program runs them. `ls-tree` is
 * recursive with no tree entries, covers the whole tree whatever the
 * directory (`--full-tree`) and is NUL-terminated so a path is printed
 * verbatim.
 */
export const snapshotArgs = {
  /** The repository's object format; only SHA-1 is accepted. */
  objectFormat: ["rev-parse", "--show-object-format"],
  /**
   * The ignored paths, before anything is staged (review finding B08): an
   * ignored directory is printed once, with a trailing slash. Run with the
   * fresh index, which does not exist yet, so every path counts as
   * untracked and the base's paths are covered separately.
   */
  ignoredListing: ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
  /**
   * Whether git ignores `path`, by exit code alone: 0 ignored, 1 not
   * ignored. `./` keeps a leading `:` from reading as pathspec magic.
   */
  checkIgnore: (path: string): ReadonlyArray<string> => ["check-ignore", "-q", "--", `./${path}`],
  /** Fills the fresh index from the base revision's tree. */
  readTree: (base: Revision): ReadonlyArray<string> => ["read-tree", base],
  /** Stages every tracked and untracked file git does not ignore. */
  addAll: ["add", "-A"],
  /** Writes the staged index as a tree and prints its id. */
  writeTree: ["write-tree"],
  /** Lists every blob and gitlink of `tree`, or of the base revision's tree for the preflight. */
  listTree: (tree: Revision): ReadonlyArray<string> => ["ls-tree", "--full-tree", "-r", "-z", tree],
  /**
   * The paths that differ between `base` and `tree`, for the review brief
   * (plan "Profiles, environment and briefs"): recursive, NUL-terminated,
   * each with its status.
   */
  changedPaths: (base: Revision, tree: Revision): ReadonlyArray<string> => [
    "diff-tree", "-r", "-z", "--name-status", base, tree,
  ],
} as const

/**
 * Runs `use` with the path of a fresh index file, `index` inside a new
 * directory made in `stateDirectory`, and removes that directory
 * afterwards however `use` ends. The file does not exist when `use`
 * starts; `git read-tree` creates it. Fails with
 * {@link SnapshotIndexFailed} when the directory cannot be made.
 */
export const withTemporaryIndex = <A, E, R>(
  stateDirectory: string,
  use: (indexFile: string) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | SnapshotIndexFailed, R> =>
  Effect.acquireUseRelease(
    Effect.try({
      try: () => mkdtempSync(`${stateDirectory}/snapshot-`),
      catch: (cause) => new SnapshotIndexFailed({ stateDirectory, reason: reasonOf(cause) }),
    }),
    (directory) => use(`${directory}/index`),
    (directory) =>
      Effect.sync(() => {
        rmSync(directory, { recursive: true, force: true })
      }),
  )

/**
 * The platform's SHA-1 over the concatenation of `parts`, strings as
 * UTF-8 (FIPS 180-4, through `node:crypto`). Format's `blobId` takes it
 * as its digest.
 */
export const sha1 = (parts: ReadonlyArray<string | Uint8Array>): Uint8Array =>
  Arr.reduce(parts, createHash("sha1"), fed).digest()

/** The digest with one more part. */
const fed = (hash: Hash, part: string | Uint8Array): Hash => hash.update(part)

/** A thrown value's message. */
const reasonOf = (cause: unknown): string =>
  Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message) ? cause.message : unknownReason
