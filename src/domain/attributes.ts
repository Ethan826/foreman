// Attribute sources (design "Git environment", restrictions table row "No
// attribute-driven conversion"; plan B11c, option A and the owner rulings
// of 2026-11-19): what Runtime read from each source git would take
// attributes from under the clean environment, and the refusals Features
// gives. Option A refuses any attribute content rather than decoding
// declarations: a `.gitattributes` entry of the revision may hold only
// blank and comment lines, `<commonDir>/info/attributes` must be absent or
// empty, the repository may not set `core.attributesFile`, and its config
// may hold no conditional include (option R of 2026-11-19). A read
// failure stops the operation and is never a pass (ruling 4); when it is
// the only reason to stop, it is `AttributeSourcesUnread`, not a refusal
// (owner ruling on B11c and R01, 2026-11-20). A per-target allowance may permit exact
// lines in the root `.gitattributes` only (owner decision M09, option a).
import { Record, Schema } from "effect"
import { Revision } from "./ids.ts"
import { GitText } from "./worktree.ts"

/**
 * The object types of a tree entry (git-ls-tree(1)). The values are
 * tarlatan's own, distinct from the words git prints, which only the
 * tree-listing decoder knows and maps to these.
 */
export const TreeEntryTypes = { Blob: "blob-entry", Tree: "tree-entry", Commit: "commit-entry" } as const
/** One tree entry type; see {@link TreeEntryTypes}. */
export const TreeEntryType = Schema.Literals(Record.values(TreeEntryTypes))
/** One tree entry type. */
export type TreeEntryType = typeof TreeEntryType.Type

/** A tree entry's mode as `git ls-tree` prints it: six octal digits. */
export const TreeEntryMode = Schema.String.check(Schema.isPattern(/^[0-7]{6}$/))

/**
 * One record of `git ls-tree -z`: mode, type, object id and the path from
 * the top of the tree, verbatim (with `-z` git does not quote it).
 */
export const TreeEntry = Schema.Struct({
  mode: TreeEntryMode,
  type: TreeEntryType,
  object: Revision,
  path: GitText,
})
/** One tree entry; see {@link TreeEntry}. */
export type TreeEntry = typeof TreeEntry.Type

/** A finished git command's exit code and output, as Runtime returns it. */
export const GitResult = Schema.Struct({
  exitCode: Schema.Int,
  stdout: Schema.String,
  stderr: Schema.String,
})
/** A finished git command; see {@link GitResult}. */
export type GitResult = typeof GitResult.Type

/**
 * A tree entry whose last path component is `.gitattributes`, with the
 * result of `git cat-file blob` on it. `blob` is none when the entry is
 * not a regular blob, since only a regular blob is read.
 */
export const AttributesEntryRead = Schema.Struct({
  entry: TreeEntry,
  blob: Schema.Option(GitResult),
})
/** One `.gitattributes` entry and its read; see {@link AttributesEntryRead}. */
export type AttributesEntryRead = typeof AttributesEntryRead.Type

/** `git ls-tree` exited 0 and every record decoded, in listing order. */
export class TreeEntries extends Schema.TaggedClass<TreeEntries>()(
  "TreeEntries",
  { entries: Schema.Array(TreeEntry) },
) {}

/** `git ls-tree` exited non-zero, with its exit code and stderr. */
export class TreeNotListed extends Schema.TaggedClass<TreeNotListed>()(
  "TreeNotListed",
  { exitCode: Schema.Int, stderr: Schema.String },
) {}

/** `git ls-tree` exited 0 but its output did not decode (R5's lesson). */
export class TreeUndecodable extends Schema.TaggedClass<TreeUndecodable>()(
  "TreeUndecodable",
  { reason: Schema.String },
) {}

/** Every `.gitattributes` entry of a listed tree, with what was read of each. */
export class TreeListed extends Schema.TaggedClass<TreeListed>()(
  "TreeListed",
  { files: Schema.Array(AttributesEntryRead) },
) {}

/** One `git ls-tree` run as Format decodes it; see {@link TreeRun}. */
export const TreeRun = Schema.Union([TreeEntries, TreeNotListed, TreeUndecodable])
/** One decoded `git ls-tree` run: its entries, or why there are none. */
export type TreeRun = typeof TreeRun.Type

/** The revision's tree as Features judges it; see {@link TreeReading}. */
export const TreeReading = Schema.Union([TreeListed, TreeNotListed, TreeUndecodable])
/** The revision's `.gitattributes` entries read, or why the tree was not. */
export type TreeReading = typeof TreeReading.Type

/** What `lstat` found at a path that exists, without following a symlink. */
export const FileKinds = {
  File: "regular-file",
  Directory: "directory-kind",
  SymbolicLink: "symbolic-link",
  Other: "other-kind",
} as const
/** One file kind; see {@link FileKinds}. */
export const FileKind = Schema.Literals(Record.values(FileKinds))
/** One file kind. */
export type FileKind = typeof FileKind.Type

/** Nothing is at the path (ENOENT or ENOTDIR). */
export class FileAbsent extends Schema.TaggedClass<FileAbsent>()("FileAbsent", {}) {}

/**
 * Something is at the path. `content` is the text of a regular file and
 * empty for any other kind, which is not read.
 */
export class FileFound extends Schema.TaggedClass<FileFound>()(
  "FileFound",
  { kind: FileKind, content: Schema.String },
) {}

/** The path could not be inspected or read, with the error's message. */
export class FileUnreadable extends Schema.TaggedClass<FileUnreadable>()(
  "FileUnreadable",
  { reason: Schema.String },
) {}

/** A file read without judgment; see {@link FileReading}. */
export const FileReading = Schema.Union([FileAbsent, FileFound, FileUnreadable])
/** What Runtime found at a path: nothing, something, or a failure. */
export type FileReading = typeof FileReading.Type

/**
 * Everything the attribute check reads for one revision and repository:
 * the revision's `.gitattributes` entries, `<commonDir>/info/attributes`,
 * the run of `git config --get core.attributesFile` and the run of `git
 * config --get-regexp '^includeif\.'`, which lists every conditional
 * include key git reads whatever its condition (option R).
 */
export const AttributeReading = Schema.Struct({
  revision: Revision,
  tree: TreeReading,
  infoAttributes: Schema.Struct({ path: GitText, reading: FileReading }),
  attributesFile: GitResult,
  conditionalIncludes: GitResult,
})
/** The attribute check's raw reading; see {@link AttributeReading}. */
export type AttributeReading = typeof AttributeReading.Type

/**
 * One line an allowance permits: any text holding neither `\n` nor `\r`,
 * since a line is compared after its terminator is removed and a line
 * that held either could never match.
 */
export const AllowedAttributeLine = Schema.String.check(Schema.isPattern(/^[^\r\n]*$/))

/**
 * Exact lines a target may keep in the revision's root `.gitattributes`
 * (owner decision M09, option a), supplied per target by configuration.
 * A root line passes when it equals one of `rootLines` byte for byte
 * after its terminator (`\n`, or `\r\n`) is removed. The allowance never
 * applies to a nested `.gitattributes`, `info/attributes`, the setting or
 * a conditional include.
 */
export const AttributeAllowance = Schema.Struct({ rootLines: Schema.Array(AllowedAttributeLine) })
/** Exact lines allowed in the root `.gitattributes`; see {@link AttributeAllowance}. */
export type AttributeAllowance = typeof AttributeAllowance.Type

/** The allowance that permits no line: option A unchanged. */
export const noAttributeAllowance: AttributeAllowance = { rootLines: [] }

/** Waxwing's one root line, the only line the owner approved (decision M09). */
export const waxwingRootLine = "*.wxw linguist-language=Rust"

/**
 * The allowance a configuration may name (batch review B06): no line, or
 * Waxwing's line once. Any other line, or the line twice, fails to
 * decode; a generic allowance would need a separate owner ruling. The
 * target binding keeps it to the state directory it was bound with.
 */
export const ApprovedAttributeAllowance = Schema.Struct({
  rootLines: Schema.Union([Schema.Tuple([]), Schema.Tuple([Schema.Literal(waxwingRootLine)])]),
})
/** An allowance a configuration may name; see {@link ApprovedAttributeAllowance}. */
export type ApprovedAttributeAllowance = typeof ApprovedAttributeAllowance.Type

/**
 * The attribute sources the check reads (plan B11c, contract). A
 * conditional include counts as one because it can set
 * `core.attributesFile` in a context the check does not evaluate.
 */
export const AttributeSources = {
  Tree: "revision-gitattributes",
  InfoAttributes: "info-attributes",
  AttributesFile: "core-attributes-file",
  ConditionalInclude: "conditional-include",
} as const
/** One attribute source; see {@link AttributeSources}. */
export const AttributeSource = Schema.Literals(Record.values(AttributeSources))
/** One attribute source. */
export type AttributeSource = typeof AttributeSource.Type

/**
 * Why a source was refused: it has content (a line that is not blank or
 * a comment, or any content in `info/attributes`), it is not a regular
 * file or blob, the setting or a conditional include is configured, or
 * reading it failed.
 */
export const AttributeRefusalReasons = {
  Content: "has-content",
  NotRegular: "not-regular",
  Configured: "is-configured",
  ReadFailed: "read-failed",
} as const
/** One refusal reason; see {@link AttributeRefusalReasons}. */
export const AttributeRefusalReason = Schema.Literals(Record.values(AttributeRefusalReasons))
/** One refusal reason. */
export type AttributeRefusalReason = typeof AttributeRefusalReason.Type

/**
 * One refused source. `path` is the tree path or file path, none for the
 * setting; `line` is the 1-based line number where there is one; `detail`
 * is the refused line, the configured value, the kind found or the read
 * failure's message.
 */
export const AttributeRefusal = Schema.Struct({
  source: AttributeSource,
  reason: AttributeRefusalReason,
  path: Schema.Option(Schema.String),
  line: Schema.Option(Schema.Int),
  detail: Schema.String,
})
/** One refused source; see {@link AttributeRefusal}. */
export type AttributeRefusal = typeof AttributeRefusal.Type

/**
 * The revision or repository has an attribute source that option A or
 * option R refuses (plan B11c): at least one source was read and holds
 * what the rules forbid, so this is a judgment. `refusals` lists every
 * refusal, in source order: the tree in listing and line order, then
 * `info/attributes`, then `core.attributesFile`, then the conditional
 * includes. A source that could not be read is listed too, with reason
 * `read-failed`, so its diagnostic is kept. Creation refuses before
 * `worktree add`; the startup check stops `run`. A launch stopped by it
 * expires every armed waiver (owner ruling on B11c and R01, 2026-11-20).
 */
export class AttributeSourcesRefused extends Schema.TaggedError<AttributeSourcesRefused>()(
  "AttributeSourcesRefused",
  { revision: Revision, refusals: Schema.NonEmptyArray(AttributeRefusal) },
) {}

/**
 * The attribute check could not read one or more sources, and every
 * source it did read passed (owner ruling on B11c and R01, 2026-11-20).
 * It still stops the operation, since an unread source is never a pass
 * (ruling 4), but nothing was judged: `failures` lists each failed read,
 * every one with reason `read-failed` and its diagnostic as `detail`, in
 * the source order of {@link AttributeSourcesRefused}. A launch stopped by
 * it keeps every armed waiver.
 */
export class AttributeSourcesUnread extends Schema.TaggedError<AttributeSourcesUnread>()(
  "AttributeSourcesUnread",
  { revision: Revision, failures: Schema.NonEmptyArray(AttributeRefusal) },
) {}
