// The snapshot's wiring (plan A2, "Snapshot identity and raw checks",
// AC5). In the supervisor worktree, with git pinned to its recorded
// identity and a fresh temporary index in the state directory: refuse a
// repository that is not SHA-1, run the preflight, which refuses a base
// gitlink, a nested repository or a special file before anything is
// staged (review finding B08, M14), then `read-tree <base>`, `add -A`,
// `write-tree`, `ls-tree -r -z <tree>`, then read every entry on disk
// without following a link at its own path (Runtime), compute blob ids
// (Format) and judge (Features). Coverage: tracked and untracked files
// git does not ignore. Not covered: ignored files, empty directories,
// anything outside the worktree, and the git directory. Staging writes
// blob and tree objects; the worktree's own index is never read or
// written and no ref moves. The reads assume the assisted rung's
// quiescence, with no concurrent writer (review limit L02).
import { Effect, Match } from "effect"
import type { TreeEntry } from "../domain/attributes.ts"
import type { Revision } from "../domain/ids.ts"
import {
  ObservedAbsent,
  ObservedLink,
  ObservedOther,
  ObservedRegular,
  ObservedUnreadable,
  SnapshotObjectFormatRefused,
  SnapshotRefused,
  type ObservedEntry,
  type SnapshotVerdict,
} from "../domain/snapshot.ts"
import { judgeSnapshot } from "../features/snapshot.ts"
import { blobId, isSha1ObjectFormat } from "../format/blob-id.ts"
import { decodeRevParseRevision } from "../format/rev-parse.ts"
import { snapshotGitWith, startGit, type GitOutput, type RecordedGitIdentity, type RunGit, type StartGit } from "../runtime/git.ts"
import { sha1, snapshotArgs, withTemporaryIndex } from "../runtime/snapshot.ts"
import { readWorktreeEntry, type WorktreeEntryReading } from "../runtime/worktree-entries.ts"
import { preflight } from "./snapshot-preflight.ts"
import { listed, stepFailed, succeeded } from "./snapshot-steps.ts"

/** Where a snapshot is taken. */
export interface SnapshotSite {
  /** The supervisor worktree's top level, where git runs and entries are read. */
  readonly worktree: string
  /** foreman's state directory, which holds the temporary index while the snapshot runs. */
  readonly stateDirectory: string
}

/** git's blob id over the platform SHA-1. */
const blobOf = blobId(sha1)

/**
 * The snapshot over an injected process call, for `home` and the recorded
 * identity: succeeds with the staged tree's id when every entry passes
 * the raw checks. Fails with `SnapshotObjectFormatRefused` before staging
 * when the repository is not SHA-1; with `SnapshotPreflightRefused`, every
 * finding listed, before staging when the base tree holds a gitlink or the
 * covered worktree holds a nested repository or a special file; with
 * `SnapshotStepFailed` when a git command exits non-zero or prints what
 * does not decode; with `SnapshotRefused`, the tree and every mismatch,
 * when the raw checks fail; with `SnapshotIndexFailed` when the temporary
 * index's directory cannot be made; and with `GitCommandFailed` when git
 * could not start or printed bytes that are not UTF-8.
 */
export const snapshotProgramWith = (start: StartGit) => (home: string) => (identity: RecordedGitIdentity) =>
  Effect.fn("takeSnapshot")(function* (site: SnapshotSite, base: Revision) {
    const runFor = snapshotGitWith(start)(home)(identity)
    return yield* withTemporaryIndex(site.stateDirectory, (indexFile) => staged(runFor(indexFile), site.worktree, base))
  })

/** The production snapshot: {@link snapshotProgramWith} over the real process call. */
export const snapshotProgram = snapshotProgramWith(startGit)

/** The steps in one temporary index: the format check, the preflight, staging, listing, reading and judging. */
const staged = Effect.fn("stageSnapshot")(function* (run: RunGit, cwd: string, base: Revision) {
  const format = yield* run(cwd, snapshotArgs.objectFormat)
  if (!isSha1ObjectFormat(format)) {
    return yield* new SnapshotObjectFormatRefused({ exitCode: format.exitCode, stdout: format.stdout })
  }
  yield* preflight(run, cwd, base)
  yield* succeeded(run, cwd, snapshotArgs.readTree(base))
  yield* succeeded(run, cwd, snapshotArgs.addAll)
  const written = yield* succeeded(run, cwd, snapshotArgs.writeTree)
  const tree = yield* decodedTree(written)
  const entries = yield* listed(run, cwd, tree)
  const observed = yield* Effect.forEach(entries, observe(cwd))
  return yield* verdictFor(tree, judgeSnapshot(entries, observed))
})

/** The tree id `write-tree` printed. */
const decodedTree = (output: GitOutput) =>
  Effect.mapError(
    Effect.fromResult(decodeRevParseRevision(output.stdout)),
    (issue) => stepFailed(snapshotArgs.writeTree, output, issue.message),
  )

/** What is on disk at one entry's path, with blob ids computed. */
const observe = (cwd: string) => (entry: TreeEntry) =>
  Effect.map(readWorktreeEntry(`${cwd}/${entry.path}`), observedAs(entry.path))

/** Runtime's reading as Domain's observation, with the blob id of a file's bytes or a link's text. */
const observedAs =
  (path: string) =>
  (reading: WorktreeEntryReading): ObservedEntry =>
    Match.valueTags(reading, {
      RegularRead: (file) => new ObservedRegular({ path, executable: file.executable, blob: blobOf(file.bytes) }),
      LinkRead: (link) => new ObservedLink({ path, blob: blobOf(link.text) }),
      OtherRead: () => new ObservedOther({ path }),
      EntryAbsent: () => new ObservedAbsent({ path }),
      EntryUnreadable: (failed) => new ObservedUnreadable({ path, reason: failed.reason }),
    })

/** The tree when the raw checks pass, or the refusal listing every mismatch. */
const verdictFor = (tree: Revision, verdict: SnapshotVerdict) =>
  Match.valueTags(verdict, {
    SnapshotConsistent: () => Effect.succeed(tree),
    SnapshotInconsistent: (found) => Effect.fail(new SnapshotRefused({ tree, mismatches: found.mismatches })),
  })
