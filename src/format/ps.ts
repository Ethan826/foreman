// Decoder for `ps -A -o pid,pgid,lstart,command` (plan "Process
// evidence"), as BSD ps on macOS and procps on Linux print it under
// LC_ALL=C: a header line, then one line per process. Columns are
// separated by runs of spaces; lstart has the fixed layout
// `Www Mmm dd hh:mm:ss yyyy` with the day padded by a space, and the
// command is the rest of the line, spaces included (its leading spaces
// are taken as the separator). Decoding is strict: a missing final
// newline, another header or any row that does not decode fails the whole
// listing, because a skipped row would hide a process from the evidence.
// A command containing a newline therefore fails the listing too.
import { Array as Arr, Option, Result, Schema, String } from "effect"
import { ProcessId, ProcessListingUndecodable, StartTime, type ProcessRow } from "../domain/process.ts"

/** The newline that ends every line of the listing. */
const lineEnd = "\n"

/** The number of characters in {@link lineEnd}. */
const lineEndLength = 1

/** The header the four columns print, with any column padding. */
const headerPattern = /^ *PID +PGID +STARTED +COMMAND$/

/** One row: pid, pgid, lstart in its fixed layout, then a non-empty command. */
const rowPattern =
  /^ *(?<pid>\d+) +(?<pgid>\d+) +(?<startedAt>[A-Z][a-z]{2} [A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}) +(?<command>\S.*)$/

/** A row's captured columns, with the ids decoded from their digits. */
const RowColumns = Schema.Struct({
  pid: Schema.NumberFromString.pipe(Schema.decodeTo(ProcessId)),
  pgid: Schema.NumberFromString.pipe(Schema.decodeTo(ProcessId)),
  startedAt: StartTime,
  command: Schema.String,
})

const decodeColumns = Schema.decodeUnknownOption(RowColumns)

/**
 * Decodes a whole listing into its rows, in listing order. A header with
 * no rows decodes to no rows. Fails with {@link ProcessListingUndecodable}
 * naming the first line that does not decode, or when the text does not
 * end in a newline or does not start with the header.
 */
export const decodePs = (text: string): Result.Result<ReadonlyArray<ProcessRow>, ProcessListingUndecodable> =>
  String.endsWith(lineEnd)(text)
    ? decodeLines(String.split(withoutLineEnd(text), lineEnd))
    : Result.fail(undecodable("the listing does not end in a newline"))

/**
 * The start time of the row whose pid is `pid`, or none when the listing
 * does not decode or lists no such process. This is how the leader's start
 * is read right after spawn (plan "Process evidence"); an unreadable start
 * is recorded as none.
 */
export const startTimeOf = (text: string, pid: number): Option.Option<string> =>
  Option.map(Option.flatMap(Result.getSuccess(decodePs(text)), Arr.findFirst(hasPid(pid))), startOfRow)

/** The text without its final newline, which {@link decodePs} checked is there. */
const withoutLineEnd = String.slice(0, -lineEndLength)

/** The header line, then each row; the header must be exactly the four columns. */
const decodeLines = (lines: ReadonlyArray<string>) =>
  Option.match(Arr.head(lines), {
    onNone: () => Result.fail(undecodable("the listing is empty")),
    onSome: (header) =>
      headerPattern.test(header)
        ? Result.all(Arr.map(Arr.drop(lines, 1), decodeRow))
        : Result.fail(undecodable(`unexpected header: ${header}`)),
  })

/** One row, or the failure that names it. */
const decodeRow = (line: string): Result.Result<ProcessRow, ProcessListingUndecodable> =>
  Result.fromOption(
    Option.flatMap(Option.flatMap(String.match(rowPattern)(line), groupsOf), decodeColumns),
    () => undecodable(`undecodable row: ${line}`),
  )

/** A match's named groups, which every match of {@link rowPattern} has. */
const groupsOf = (match: RegExpMatchArray) => Option.fromNullishOr(match.groups)

/** Whether a row is the process `pid`. */
const hasPid =
  (pid: number) =>
  (row: ProcessRow): boolean =>
    row.pid === pid

/** A row's start time. */
const startOfRow = (row: ProcessRow): string => row.startedAt

/** The failure for a listing that does not decode. */
const undecodable = (reason: string) => new ProcessListingUndecodable({ reason })
