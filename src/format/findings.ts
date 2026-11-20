// The reviewer's findings block (plan "Outcomes and usable attempts",
// decision P8; "Profiles, environment and briefs", Findings): the last
// fenced code block whose info string is `json` in the reviewer's final
// message, decoded as a list of findings, and the owner's draft
// findings.md rendered from that list. Fences follow CommonMark 0.31.2,
// section 4.5 (fenced code blocks): an opening fence is three or more
// backticks or tildes indented at most three spaces; a backtick fence's
// info string holds no backtick; the block closes at a fence of the same
// character at least as long with nothing after it but spaces, or at the
// end of the message. A fence inside another block is that block's text.
import { Array, Option, Record, Result, Schema, String, pipe } from "effect"
import {
  Findings,
  MalformedFindings,
  NoFindingsBlock,
  type Finding,
} from "../domain/findings.ts"

/** The info string that marks the findings block. */
const jsonInfo = "json"

/** An opening backtick fence, with its marker and its info string. */
const backtickOpening = /^ {0,3}(?<marker>`{3,})(?<info>[^`]*)$/

/** An opening tilde fence, with its marker and its info string. */
const tildeOpening = /^ {0,3}(?<marker>~{3,})(?<info>.*)$/

/** A line that could close a block: a marker and trailing spaces only. */
const closingFence = /^ {0,3}(?<marker>`{3,}|~{3,})[ \t]*$/

/** The draft's heading. */
const draftHeading = "# Findings"

/** The draft's text when the reviewer reported nothing. */
const noFindings = "No findings."

/** What separates the draft's paragraphs: one blank line. */
const paragraphBreak = "\n\n"

/** A fence's marker (its run of backticks or tildes) and info string. */
interface Fence {
  readonly marker: string
  readonly info: string
}

/** A block opened and not yet closed, with the lines read so far. */
interface OpenBlock {
  readonly marker: string
  readonly isJson: boolean
  readonly body: ReadonlyArray<string>
}

/** The scan of a message: the open block and the last closed json body. */
interface Scan {
  readonly open: Option.Option<OpenBlock>
  readonly lastJson: Option.Option<ReadonlyArray<string>>
}

const decodeFindings = Schema.decodeUnknownResult(
  Schema.fromJsonString(Findings),
)

/**
 * Decodes the findings block of a reviewer's final message `text`: the
 * last fenced block whose info string, trimmed, is exactly `json`. Fails
 * with {@link NoFindingsBlock} when there is none, and with
 * {@link MalformedFindings} when its text is not a JSON list of findings.
 * An empty list decodes to no findings. Earlier blocks are not read, so
 * a malformed draft followed by a valid block decodes.
 */
export const decodeFindingsBlock = (
  text: string,
): Result.Result<Findings, NoFindingsBlock | MalformedFindings> =>
  pipe(
    lastJsonBody(text),
    Result.fromOption(noBlock),
    Result.flatMap(decodeBody),
  )

/**
 * The owner's draft findings.md for `findings`: a heading, then for each
 * finding a `## id (severity)` heading, a `File:` line when it names a
 * file, and its summary, separated by blank lines and ending in one
 * newline. An empty list renders as "No findings." under the heading.
 */
export const renderFindingsDraft = (findings: Findings): string =>
  `${Array.join([draftHeading, ...draftBody(findings)], paragraphBreak)}\n`

/** The text of the last json block in `text`, its lines joined. */
const lastJsonBody = (text: string): Option.Option<string> =>
  pipe(
    Array.fromIterable(String.linesIterator(text)),
    Array.reduce(emptyScan, scanLine),
    endOfMessage,
    joinedLastJson,
  )

/** The scan before the first line: no open block, no json body yet. */
const emptyScan: Scan = { open: Option.none(), lastJson: Option.none() }

/** Reads one line: outside a block it may open one, inside it may close. */
const scanLine = (scan: Scan, line: string): Scan =>
  Option.match(scan.open, {
    onNone: () => scanOutside(scan, line),
    onSome: (open) => scanInside(scan, open, line),
  })

/** Outside a block, an opening fence opens one; other lines are prose. */
const scanOutside = (scan: Scan, line: string): Scan =>
  pipe(
    openingFence(line),
    Option.map(openedBy(scan)),
    Option.getOrElse(() => scan),
  )

/** Inside a block, a closing fence closes it; any other line is its text. */
const scanInside = (scan: Scan, open: OpenBlock, line: string): Scan =>
  closes(open, line) ? closeBlock(scan, open) : extendBlock(scan, open, line)

/** The scan with a block opened by `fence`. */
const openedBy = (scan: Scan) => (fence: Fence): Scan => ({
  ...scan,
  open: Option.some({
    marker: fence.marker,
    isJson: String.trim(fence.info) === jsonInfo,
    body: [],
  }),
})

/** The scan with `open` closed; a json block becomes the last json body. */
const closeBlock = (scan: Scan, open: OpenBlock): Scan => ({
  open: Option.none(),
  lastJson: open.isJson ? Option.some(open.body) : scan.lastJson,
})

/** The scan with `line` added to the open block's text. */
const extendBlock = (scan: Scan, open: OpenBlock, line: string): Scan => ({
  ...scan,
  open: Option.some({ ...open, body: Array.append(open.body, line) }),
})

/** The end of the message closes a block still open (CommonMark 4.5). */
const endOfMessage = (scan: Scan): Scan =>
  Option.match(scan.open, {
    onNone: () => scan,
    onSome: (open) => closeBlock(scan, open),
  })

/** The last json body's lines joined by newlines. */
const joinedLastJson = (scan: Scan): Option.Option<string> =>
  Option.map(scan.lastJson, Array.join("\n"))

/** The fence `line` opens, if it opens one. */
const openingFence = (line: string): Option.Option<Fence> =>
  pipe(
    String.match(backtickOpening)(line),
    Option.orElse(() => String.match(tildeOpening)(line)),
    Option.flatMap(fenceOf),
  )

/**
 * Whether `line` closes `open`: a closing fence whose marker starts with
 * the open marker, so it is the same character and at least as long.
 */
const closes = (open: OpenBlock, line: string): boolean =>
  pipe(
    String.match(closingFence)(line),
    Option.flatMap(groupNamed("marker")),
    Option.exists(String.startsWith(open.marker)),
  )

/** The marker and info string a fence pattern captured. */
const fenceOf = (match: RegExpMatchArray): Option.Option<Fence> =>
  Option.all({
    marker: groupNamed("marker")(match),
    info: groupNamed("info")(match),
  })

/** The text a match captured in the group called `name`. */
const groupNamed = (name: string) => (match: RegExpMatchArray) =>
  pipe(Option.fromNullishOr(match.groups), Option.flatMap(Record.get(name)))

/** The failure for a message with no json block. */
const noBlock = () => new NoFindingsBlock()

/** Decodes a block's text, mapping a decode failure to the domain error. */
const decodeBody = (body: string) =>
  pipe(decodeFindings(body), Result.mapError(malformed))

/** The domain error for a block that does not decode. */
const malformed = (error: Schema.SchemaError) =>
  new MalformedFindings({ reason: error.message })

/** The draft's paragraphs after the heading. */
const draftBody = (findings: Findings): ReadonlyArray<string> =>
  Array.isReadonlyArrayNonEmpty(findings)
    ? Array.flatMap(findings, findingParagraphs)
    : [noFindings]

/** One finding's heading, its file line when it has a file, its summary. */
const findingParagraphs = (finding: Finding): ReadonlyArray<string> => [
  `## ${finding.id} (${finding.severity})`,
  ...Option.toArray(Option.map(finding.file, fileLine)),
  finding.summary,
]

/** The line naming a finding's file, as inline code. */
const fileLine = (file: string) => `File: \`${file}\``
