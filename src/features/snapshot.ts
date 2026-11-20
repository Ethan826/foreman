// The snapshot's raw checks and the review's currency (plan A2, "Snapshot
// identity and raw checks", AC5, M14). git staged the worktree into a
// tree; these checks confirm that each entry of that tree is exactly what
// is on disk, read with `lstat` and never through a link at the entry's
// own path (the directories above it are trusted under the rung's
// quiescence, review limit L02), so a conversion
// git applied while staging (such as `core.autocrlf`) or a change after
// staging is refused rather than reviewed. A gitlink, and any mode other
// than a regular, executable or symbolic-link blob, is refused.
import { Array as Arr, HashMap, Match, Option } from "effect"
import { TreeEntryTypes, type TreeEntry } from "../domain/attributes.ts"
import type { Revision } from "../domain/ids.ts"
import type { ObservedEntry, ObservedLink, ObservedRegular, ReviewCurrency, SnapshotMismatch, SnapshotVerdict } from "../domain/snapshot.ts"
import {
  ContentMismatch,
  EntryNotObserved,
  ExecutableMismatch,
  KindMismatch,
  ModeRefused,
  ReviewCurrent,
  ReviewStale,
  SnapshotConsistent,
  SnapshotInconsistent,
} from "../domain/snapshot.ts"

/** The mode of a regular, non-executable file (git-ls-tree(1)). */
const regularMode = "100644"

/** The mode of an executable regular file. */
const executableMode = "100755"

/** The mode of a symbolic link, whose blob is its link text. */
const linkMode = "120000"

/** The modes the raw checks accept, each of type blob. */
const acceptedModes: ReadonlyArray<string> = [regularMode, executableMode, linkMode]

/** The observations, looked up by path. */
type ObservedByPath = HashMap.HashMap<string, ObservedEntry>

/**
 * The raw checks over a staged tree's entries (`ls-tree -r`, so no tree
 * entries) and what was found at each path. Modes 100644 and 100755 need
 * a regular file whose executable bit matches the mode and whose bytes
 * have the entry's blob id; mode 120000 needs a symbolic link whose link
 * text has it; any other mode, including a gitlink, is refused whatever is
 * on disk. Lists every mismatch in tree order. An entry with no
 * observation is a mismatch; observations for paths not in the tree are
 * ignored.
 */
export const judgeSnapshot = (
  entries: ReadonlyArray<TreeEntry>,
  observed: ReadonlyArray<ObservedEntry>,
): SnapshotVerdict => {
  const byPath = HashMap.fromIterable(Arr.map(observed, keyedByPath))
  const mismatches = Arr.flatMap(entries, mismatchesOf(byPath))
  return Arr.isReadonlyArrayNonEmpty(mismatches) ? new SnapshotInconsistent({ mismatches }) : new SnapshotConsistent()
}

/**
 * Whether a review of tree `reviewed` still applies when a fresh snapshot
 * gives `current`: only when the two tree ids are equal.
 */
export const reviewCurrent = (reviewed: Revision, current: Revision): ReviewCurrency =>
  reviewed === current ? new ReviewCurrent({ tree: reviewed }) : new ReviewStale({ reviewed, current })

/** An observation as a map entry keyed by its path. */
const keyedByPath = (found: ObservedEntry): readonly [string, ObservedEntry] => [found.path, found]

/** One entry's mismatches: a refused mode, a missing observation, or the checks for its kind. */
const mismatchesOf =
  (byPath: ObservedByPath) =>
  (entry: TreeEntry): ReadonlyArray<SnapshotMismatch> =>
    isAcceptedEntry(entry)
      ? Option.match(HashMap.get(byPath, entry.path), {
          onNone: () => [new EntryNotObserved({ entry })],
          onSome: checksFor(entry),
        })
      : [new ModeRefused({ entry })]

/** Whether the entry is a blob of an accepted mode. */
const isAcceptedEntry = (entry: TreeEntry): boolean =>
  entry.type === TreeEntryTypes.Blob && Arr.contains(acceptedModes, entry.mode)

/** The checks for the entry's kind against what was found at its path. */
const checksFor =
  (entry: TreeEntry) =>
  (found: ObservedEntry): ReadonlyArray<SnapshotMismatch> =>
    entry.mode === linkMode ? linkChecks(entry, found) : regularChecks(entry, found)

/** A link entry: a symbolic link whose text has the entry's blob id. */
const linkChecks = (entry: TreeEntry, found: ObservedEntry): ReadonlyArray<SnapshotMismatch> =>
  Match.value(found).pipe(
    Match.tag("ObservedLink", (link: ObservedLink) => contentChecks(entry, link.blob)),
    Match.orElse(() => [new KindMismatch({ entry, found })]),
  )

/** A file entry: a regular file with the mode's executable bit and the entry's blob id. */
const regularChecks = (entry: TreeEntry, found: ObservedEntry): ReadonlyArray<SnapshotMismatch> =>
  Match.value(found).pipe(
    Match.tag("ObservedRegular", (file: ObservedRegular) => [
      ...executableChecks(entry, file.executable),
      ...contentChecks(entry, file.blob),
    ]),
    Match.orElse(() => [new KindMismatch({ entry, found })]),
  )

/** A mismatch when the file's executable bit disagrees with the entry's mode. */
const executableChecks = (entry: TreeEntry, executable: boolean): ReadonlyArray<SnapshotMismatch> =>
  executable === (entry.mode === executableMode) ? [] : [new ExecutableMismatch({ entry, executable })]

/** A mismatch when the blob id on disk differs from the entry's object id. */
const contentChecks = (entry: TreeEntry, blob: string): ReadonlyArray<SnapshotMismatch> =>
  blob === entry.object ? [] : [new ContentMismatch({ entry, blob })]
