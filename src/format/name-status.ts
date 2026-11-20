// Decoder for `git diff-tree -r --name-status -z <base> <tree>`, the
// changed paths in a review brief (plan "Profiles, environment and
// briefs"). With -z every field ends in a NUL and paths are printed
// verbatim (git-diff-tree(1), "Raw output format"): a status, then one
// path, or for a rename or copy a status with its similarity score, then
// the source path and the destination path. The decoder is strict: output
// that is not empty and not NUL-terminated, an unknown status, an empty
// path or a record cut short makes the whole output undecodable, never a
// shorter list. git's status letters are known only here (AGENTS.md,
// "Closed vocabularies"); a decoded entry keeps the status as git printed
// it, since the brief shows it to the reviewer as it is.
import { Array, Formatter, Option, Result, Schema, String, pipe } from "effect"

/** The byte that ends every field. */
const fieldEnd = "\0"

/**
 * The statuses printed with one path: added, deleted, modified and type
 * changed. `U` (unmerged) cannot occur between two trees and `X` marks a
 * git bug, so both are refused, as is a modification's dissimilarity
 * score, which only `-B` prints and the brief's command does not pass.
 */
const onePathStatus = /^[ADMT]$/

/**
 * The statuses printed with two paths: a rename or a copy, followed by
 * its similarity score, three digits from 000 to 100.
 */
const twoPathStatus = /^[RC](?:0[0-9]{2}|100)$/

/**
 * One changed path between the base revision and the tree: the `status`
 * as git printed it (`M`, or `R100` with its score), the `source` path of
 * a rename or copy, and the `path` itself. Paths are verbatim and may hold
 * tabs, spaces or newlines.
 */
export interface ChangedPath {
  readonly status: string
  readonly source: Option.Option<string>
  readonly path: string
}

/** `git diff-tree --name-status -z` output that does not decode. */
export class NameStatusUndecodable
  extends Schema.TaggedError<NameStatusUndecodable>()(
    "NameStatusUndecodable",
    { reason: Schema.String },
  ) {}

/** A record whose status is read and whose last path is still to come. */
interface Pending {
  readonly status: string
  readonly twoPaths: boolean
  readonly source: Option.Option<string>
}

/** The scan so far: the records read and the record in progress. */
interface Scan {
  readonly records: ReadonlyArray<ChangedPath>
  readonly pending: Option.Option<Pending>
}

/** Every decoder result. */
type Decoded<A> = Result.Result<A, NameStatusUndecodable>

/**
 * Decodes the output of `git diff-tree -r --name-status -z` into its
 * changed paths, in git's order. Empty output is no changes. Fails with
 * {@link NameStatusUndecodable} on output that does not end in a NUL, an
 * unknown status, an empty path, or a record without all its paths.
 */
export const decodeNameStatus = (
  output: string,
): Result.Result<ReadonlyArray<ChangedPath>, NameStatusUndecodable> =>
  pipe(
    fieldsOf(output),
    Result.flatMap(Array.reduce(Result.succeed(emptyScan), readNext)),
    Result.flatMap(finished),
  )

/** The scan before the first field. */
const emptyScan: Scan = { records: [], pending: Option.none() }

/** The NUL-terminated fields of `output`; empty output has none. */
const fieldsOf = (output: string): Decoded<ReadonlyArray<string>> =>
  String.isEmpty(output) || String.endsWith(fieldEnd)(output)
    ? Result.succeed(Array.dropRight(String.split(output, fieldEnd), 1))
    : Result.fail(undecodable("the output does not end in a NUL"))

/** Reads one field into a scan that has not failed. */
const readNext = (scan: Decoded<Scan>, field: string): Decoded<Scan> =>
  Result.flatMap(scan, readField(field))

/** Between records a field is a status; inside one it is a path. */
const readField = (field: string) => (scan: Scan): Decoded<Scan> =>
  Option.match(scan.pending, {
    onNone: () => startRecord(scan, field),
    onSome: (pending) => readPath(scan, pending, field),
  })

/** Starts a record at a known status; any other text is refused. */
const startRecord = (scan: Scan, status: string): Decoded<Scan> =>
  pipe(
    takesTwoPaths(status),
    Result.fromOption(() => undecodable(`unknown status ${quoted(status)}`)),
    Result.map(pendingAt(scan, status)),
  )

/** The scan with a record at `status` in progress. */
const pendingAt =
  (scan: Scan, status: string) => (twoPaths: boolean): Scan => ({
    ...scan,
    pending: Option.some({ status, twoPaths, source: Option.none() }),
  })

/** Whether `status` takes two paths, or none when it is not a status. */
const takesTwoPaths = (status: string): Option.Option<boolean> =>
  Option.isSome(String.match(onePathStatus)(status))
    ? Option.some(false)
    : Option.map(String.match(twoPathStatus)(status), matchedTwoPaths)

/** A two-path status matched. */
const matchedTwoPaths = () => true

/** Adds a non-empty path to the record in progress. */
const readPath = (scan: Scan, pending: Pending, path: string): Decoded<Scan> =>
  String.isEmpty(path)
    ? Result.fail(undecodable(`an empty path after ${quoted(pending.status)}`))
    : Result.succeed(withPath(scan, pending, path))

/** The first of two paths is the source; the last path ends the record. */
const withPath = (scan: Scan, pending: Pending, path: string): Scan =>
  pending.twoPaths && Option.isNone(pending.source)
    ? { ...scan, pending: Option.some(withSource(pending, path)) }
    : finishRecord(scan, pending, path)

/** The record in progress with its source path read. */
const withSource = (pending: Pending, source: string): Pending => ({
  ...pending,
  source: Option.some(source),
})

/** The scan with the record in progress ended at `path`. */
const finishRecord = (scan: Scan, pending: Pending, path: string): Scan => ({
  records: Array.append(scan.records, {
    status: pending.status,
    source: pending.source,
    path,
  }),
  pending: Option.none(),
})

/** The records, provided the output did not stop inside one. */
const finished = (scan: Scan): Decoded<ReadonlyArray<ChangedPath>> =>
  Option.match(scan.pending, {
    onNone: () => Result.succeed(scan.records),
    onSome: (pending) => Result.fail(endedEarly(pending)),
  })

/** The failure for output that stops inside a record. */
const endedEarly = (pending: Pending) =>
  undecodable(`${quoted(pending.status)} ends before its paths`)

/** A field's text quoted as a JSON string, so a NUL or newline shows. */
const quoted = (text: string) => Formatter.formatJson(text)

/** The failure, with `reason` saying what did not decode. */
const undecodable = (reason: string) => new NameStatusUndecodable({ reason })
