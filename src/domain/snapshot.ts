// Snapshot identity and raw checks (plan A2, "Snapshot identity and raw
// checks", AC5). A snapshot is the tree id of the worktree's covered
// contents, staged in a temporary index. Each entry of that tree is
// checked against what is on disk at its path, read without following a
// symbolic link at the path itself: Runtime's observations, the
// mismatches Features finds, the verdict, whether a review is still
// current, and the typed failures of taking a snapshot. Before anything is
// staged, a preflight walk of the covered worktree refuses what staging
// would drop or turn into a gitlink (review finding B08, M14). Every
// observation assumes the assisted rung's quiescence: the directories
// above a path are resolved as they stand, so a parent swapped for a link
// by a concurrent writer is not detected (review limit L02).
import { Schema } from "effect"
import { FileKind, TreeEntry } from "./attributes.ts"
import { Revision } from "./ids.ts"
import { GitText } from "./worktree.ts"

/** A SHA-1 blob id computed in-process: 40 lowercase hexadecimal digits. */
export const BlobHex = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/))
/** A computed blob id; see {@link BlobHex}. */
export type BlobHex = typeof BlobHex.Type

/**
 * A regular file at the path: whether its owner-execute bit is set (git's
 * test for mode 100755) and the blob id of its bytes.
 */
export class ObservedRegular extends Schema.TaggedClass<ObservedRegular>()(
  "ObservedRegular",
  { path: GitText, executable: Schema.Boolean, blob: BlobHex },
) {}

/** A symbolic link at the path, with the blob id of its link text; the target is never read. */
export class ObservedLink extends Schema.TaggedClass<ObservedLink>()(
  "ObservedLink",
  { path: GitText, blob: BlobHex },
) {}

/** Something at the path that is neither a regular file nor a symbolic link, such as a directory. */
export class ObservedOther extends Schema.TaggedClass<ObservedOther>()("ObservedOther", { path: GitText }) {}

/** Nothing at the path (ENOENT or ENOTDIR). */
export class ObservedAbsent extends Schema.TaggedClass<ObservedAbsent>()("ObservedAbsent", { path: GitText }) {}

/** The path could not be inspected or read, with the error's message. */
export class ObservedUnreadable extends Schema.TaggedClass<ObservedUnreadable>()(
  "ObservedUnreadable",
  { path: GitText, reason: Schema.String },
) {}

/** What Runtime found at one tree entry's path; see {@link ObservedEntry}. */
export const ObservedEntry = Schema.Union([ObservedRegular, ObservedLink, ObservedOther, ObservedAbsent, ObservedUnreadable])
/**
 * What was on disk at a path, read with `lstat`, never through a link at
 * the path itself; the directories above it are trusted to stay put
 * (review limit L02).
 */
export type ObservedEntry = typeof ObservedEntry.Type

/**
 * The entry's mode is not one the raw checks accept: a gitlink (160000),
 * or anything other than a blob of mode 100644, 100755 or 120000 (M14).
 */
export class ModeRefused extends Schema.TaggedClass<ModeRefused>()("ModeRefused", { entry: TreeEntry }) {}

/** No observation was given for the entry's path. */
export class EntryNotObserved extends Schema.TaggedClass<EntryNotObserved>()(
  "EntryNotObserved",
  { entry: TreeEntry },
) {}

/**
 * The path holds the wrong kind: not a regular file for mode 100644 or
 * 100755, not a symbolic link for 120000, or nothing, or unreadable.
 */
export class KindMismatch extends Schema.TaggedClass<KindMismatch>()(
  "KindMismatch",
  { entry: TreeEntry, found: ObservedEntry },
) {}

/** A regular file whose executable bit, shown here as found, disagrees with the entry's mode. */
export class ExecutableMismatch extends Schema.TaggedClass<ExecutableMismatch>()(
  "ExecutableMismatch",
  { entry: TreeEntry, executable: Schema.Boolean },
) {}

/**
 * The blob id of the bytes on disk (a file's content or a link's text),
 * shown here, differs from the entry's object id: git converted the
 * content while staging it, or the path changed after staging.
 */
export class ContentMismatch extends Schema.TaggedClass<ContentMismatch>()(
  "ContentMismatch",
  { entry: TreeEntry, blob: BlobHex },
) {}

/** One failed raw check; see {@link SnapshotMismatch}. */
export const SnapshotMismatch = Schema.Union([ModeRefused, EntryNotObserved, KindMismatch, ExecutableMismatch, ContentMismatch])
/** One tree entry that the bytes on disk do not support. */
export type SnapshotMismatch = typeof SnapshotMismatch.Type

/** Every entry of the tree matched what is on disk. */
export class SnapshotConsistent extends Schema.TaggedClass<SnapshotConsistent>()("SnapshotConsistent", {}) {}

/** At least one entry did not match; every mismatch, in tree order. */
export class SnapshotInconsistent extends Schema.TaggedClass<SnapshotInconsistent>()(
  "SnapshotInconsistent",
  { mismatches: Schema.Array(SnapshotMismatch) },
) {}

/** The raw checks' verdict on one staged tree; see {@link SnapshotVerdict}. */
export const SnapshotVerdict = Schema.Union([SnapshotConsistent, SnapshotInconsistent])
/** Whether the staged tree is exactly what is on disk. */
export type SnapshotVerdict = typeof SnapshotVerdict.Type

/** The fresh snapshot is the tree that was reviewed. */
export class ReviewCurrent extends Schema.TaggedClass<ReviewCurrent>()("ReviewCurrent", { tree: Revision }) {}

/**
 * The fresh snapshot differs from the reviewed tree, so the review is
 * stale. Equality would show only that the covered contents are the same
 * at both endpoints, not that nothing was written in between.
 */
export class ReviewStale extends Schema.TaggedClass<ReviewStale>()(
  "ReviewStale",
  { reviewed: Revision, current: Revision },
) {}

/** Whether a review still applies; see {@link ReviewCurrency}. */
export const ReviewCurrency = Schema.Union([ReviewCurrent, ReviewStale])
/** Whether a review still applies to the worktree's current tree. */
export type ReviewCurrency = typeof ReviewCurrency.Type

/**
 * The repository's object format is not SHA-1, so in-process blob ids
 * cannot be compared with its objects. Holds the `rev-parse
 * --show-object-format` run's exit code and stdout.
 */
export class SnapshotObjectFormatRefused extends Schema.TaggedError<SnapshotObjectFormatRefused>()(
  "SnapshotObjectFormatRefused",
  { exitCode: Schema.Int, stdout: Schema.String },
) {}

/** A snapshot git command exited non-zero or printed what could not be decoded. */
export class SnapshotStepFailed extends Schema.TaggedError<SnapshotStepFailed>()(
  "SnapshotStepFailed",
  { args: Schema.Array(Schema.String), exitCode: Schema.Int, detail: Schema.String },
) {}

/** The temporary index's directory could not be made in the state directory. */
export class SnapshotIndexFailed extends Schema.TaggedError<SnapshotIndexFailed>()(
  "SnapshotIndexFailed",
  { stateDirectory: Schema.String, reason: Schema.String },
) {}

/** The staged tree failed the raw checks: the tree id and every mismatch. */
export class SnapshotRefused extends Schema.TaggedError<SnapshotRefused>()(
  "SnapshotRefused",
  { tree: Revision, mismatches: Schema.Array(SnapshotMismatch) },
) {}

/**
 * One entry of a directory as the preflight walk found it with `lstat`,
 * never through a link at the entry: its name, decoded as strict UTF-8,
 * and its kind.
 */
export const WalkedChild = Schema.Struct({ name: GitText, kind: FileKind })
/** One entry of a walked directory; see {@link WalkedChild}. */
export type WalkedChild = typeof WalkedChild.Type

/** The base revision's tree holds a gitlink (mode 160000) at the path. */
export class GitlinkInBase extends Schema.TaggedClass<GitlinkInBase>()("GitlinkInBase", { path: GitText }) {}

/**
 * A covered directory holds a `.git` entry of any kind, so `add -A` would
 * stage it as a gitlink or skip the files under its git directory.
 */
export class NestedRepository extends Schema.TaggedClass<NestedRepository>()(
  "NestedRepository",
  { path: GitText },
) {}

/**
 * A covered path is neither a regular file, a directory nor a symbolic
 * link (a FIFO, a socket or a device), which `add -A` silently leaves out.
 */
export class SpecialFile extends Schema.TaggedClass<SpecialFile>()("SpecialFile", { path: GitText }) {}

/**
 * A covered directory could not be listed, one of its entries could not
 * be inspected, or an entry's name is not valid UTF-8; `.` is the
 * worktree's top level.
 */
export class WalkUnreadable extends Schema.TaggedClass<WalkUnreadable>()(
  "WalkUnreadable",
  { path: GitText, reason: Schema.String },
) {}

/** One reason the preflight refuses; see {@link PreflightFinding}. */
export const PreflightFinding = Schema.Union([GitlinkInBase, NestedRepository, SpecialFile, WalkUnreadable])
/** What the preflight walk found that the snapshot cannot cover exactly. */
export type PreflightFinding = typeof PreflightFinding.Type

/**
 * The preflight refused the worktree before anything was staged: no
 * `read-tree`, `add` or `write-tree` ran. Lists every finding.
 */
export class SnapshotPreflightRefused extends Schema.TaggedError<SnapshotPreflightRefused>()(
  "SnapshotPreflightRefused",
  { findings: Schema.Array(PreflightFinding) },
) {}

/**
 * The walk descends into the directory at `path`; when `unlessIgnored`,
 * only after `git check-ignore` says the directory is not ignored.
 */
export class WalkInto extends Schema.TaggedClass<WalkInto>()(
  "WalkInto",
  { path: GitText, unlessIgnored: Schema.Boolean },
) {}

/**
 * The walk records `finding`; when `unlessIgnored`, only after `git
 * check-ignore` says its path is not ignored.
 */
export class WalkFound extends Schema.TaggedClass<WalkFound>()(
  "WalkFound",
  { finding: PreflightFinding, unlessIgnored: Schema.Boolean },
) {}

/** One step the walk takes for a listed directory; see {@link WalkStep}. */
export const WalkStep = Schema.Union([WalkInto, WalkFound])
/** What the walk does next for one entry of a listed directory. */
export type WalkStep = typeof WalkStep.Type
