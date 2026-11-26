// The text each client receives (plan "Profiles, environment and
// briefs"): implement takes the task file; review takes the task, the
// tree id, the base revision, the changed paths, the last handoff, the
// coverage statement, and asks for a fenced JSON findings block; correct
// takes the task, the owner's findings file, the prior handoff and the
// tree id. Implement and correct also take the configured check commands,
// named in one line when there are any (dogfood-3b). Every brief lists
// the session's owner rulings right after the task (v0.2.0, "Briefs"),
// so the brief's recorded hash covers them. Program reads the
// recorded files and passes their contents;
// these functions do no I/O and write nothing into a brief that was not
// passed in, apart from their own fixed wording. Every brief says the
// agent works in a fresh session, since each step starts a new client
// with no earlier transcript (design: context is renewed every step).
import { Array, Formatter, Option, String } from "effect"
import type { Revision } from "../domain/ids.ts"
import { Roles, type Role } from "../domain/roles.ts"
import type { Ruling } from "../domain/rulings.ts"
import type { ChangedPath } from "./name-status.ts"

/**
 * The snapshot coverage statement (plan "Snapshot identity and raw
 * checks", Coverage) that `status` and every review brief state: what a
 * snapshot tree holds, and what it leaves out.
 */
export const snapshotCoverage =
  "The tree covers tracked files and untracked files that git does not\n" +
  "ignore. It does not cover ignored files, empty directories, anything\n" +
  "outside the working directory, or the git directory."

/** What a brief says in place of a file that is empty. */
const emptyText = "(empty)"

/** What separates the lines of a paragraph. */
const lineBreak = "\n"

/** What separates a brief's paragraphs: one blank line. */
const paragraphBreak = "\n\n"

/** The statement that the agent has no earlier transcript. */
const freshSession =
  "You work in a fresh session: you have no transcript of any earlier\n" +
  "session, and everything you need is in this brief."

/** The implementer's closing instruction. */
const implementInstruction =
  "Carry out the task in the working directory. Do not commit. End your\n" +
  "reply with a short handoff: what you changed, what you left undone, and\n" +
  "what the reviewer should check."

/** The corrector's closing instruction. */
const correctInstruction =
  "Address each finding in the working directory. Do not commit. End your\n" +
  "reply with a short handoff: what you changed for each finding and what\n" +
  "you left open."

/** The line before a non-empty list of changed paths. */
const changesIntroduction =
  "From `git diff-tree -r --name-status` between the base revision and the\n" +
  "tree, each path as a JSON string:"

/** What the review brief says when the diff lists nothing. */
const noChanges = "No path changed between the base revision and the tree."

/**
 * The reviewer's closing request: a final fenced `json` block holding an
 * array of findings in the shape `decodeFindingsBlock` (findings.ts)
 * accepts, with an example in that shape, the rule that each finding's id
 * is distinct (a repeated id makes the block malformed; v0.2.0 design,
 * "Commands and events"), and the rule that an empty array requests no
 * changes (plan "Outcomes and usable attempts").
 */
const findingsRequest = Array.join([
  "Review the changes against the task. End your reply with a fenced code",
  "block tagged json that holds an array of findings. Each finding is an",
  'object with "id", "severity", an optional "file" and "summary", and',
  "every value is a non-empty string. For example:",
  "",
  "```json",
  "[",
  "  {",
  '    "id": "F1",',
  '    "severity": "major",',
  '    "file": "src/example.ts",',
  '    "summary": "What is wrong, and why."',
  "  }",
  "]",
  "```",
  "",
  'Each finding\'s "id" must be distinct from every other finding\'s id.',
  "An empty array, [], means you request no changes.",
], lineBreak)

/**
 * The line that ends "What to do" when the configuration names check
 * commands (dogfood-3b): the commands in configuration order, each in
 * backticks, on one unwrapped line. The profile allows each as one exact
 * Bash rule; the timeout is in milliseconds.
 */
const checkCommandsLine = (commands: ReadonlyArray<string>) =>
  "You may run these check commands with the Bash tool, each exactly as written: " +
  `${Array.join(Array.map(commands, (command) => `\`${command}\``), ", ")}. ` +
  "They run in the Bash sandbox, with no network and the git directories read-only; " +
  "give the Bash tool a timeout of 600000 ms."

/**
 * The body of "What to do": `instruction`, then a blank line and the
 * check commands line when `checkCommands` is non-empty. With none it is
 * `instruction` alone, byte for byte.
 */
const whatToDo = (instruction: string, checkCommands: ReadonlyArray<string>) =>
  Array.isReadonlyArrayNonEmpty(checkCommands)
    ? `${instruction}${paragraphBreak}${checkCommandsLine(checkCommands)}`
    : instruction

/** What the rulings section says when the session has no ruling. */
const noRulings = "None."

/**
 * What the review brief's rulings section adds after the rulings, on
 * one unwrapped line, exactly as owner ruling 7 (dogfood-6b) words it
 * (v0.2.0 design, "Briefs").
 */
const rulingsSettle =
  "A ruling settles its point. A finding that contradicts a ruling must cite the ruling's id " +
  "and say why the ruling does not cover the case, or be left out."

/**
 * The marks after a ruling's id: `(supersedes Rn)` when it supersedes
 * one, then `(superseded by Rm)` when a later one superseded it.
 */
const rulingMarks = (ruling: Ruling) =>
  Array.join(
    Array.appendAll(
      Option.toArray(Option.map(ruling.supersedes, (id) => ` (supersedes ${id})`)),
      Option.toArray(Option.map(ruling.supersededBy, (id) => ` (superseded by ${id})`)),
    ),
    "",
  )

/** One ruling as the briefs list it: `R1: <text>`, with its marks after the id. */
const rulingEntry = (ruling: Ruling) => `${ruling.id}${rulingMarks(ruling)}: ${ruling.text}`

/**
 * The body of "Owner rulings" (v0.2.0 design, "Briefs"): every ruling of
 * the session in order, its text as recorded, entries separated by a
 * blank line; `None.` when there is none.
 */
const rulingsText = (rulings: ReadonlyArray<Ruling>) =>
  Array.isReadonlyArrayNonEmpty(rulings) ? Array.join(Array.map(rulings, rulingEntry), paragraphBreak) : noRulings

/** The "Owner rulings" section, placed right after the task in every brief. */
const rulingsSection = (rulings: ReadonlyArray<Ruling>) => section("Owner rulings", rulingsText(rulings))

/**
 * The implementer's brief: the task file's contents, the session's owner
 * `rulings`, and the instruction, which ends with the check commands
 * line when `checkCommands`, the configured check commands, is non-empty.
 */
export const implementBrief = (input: {
  readonly task: string
  readonly rulings: ReadonlyArray<Ruling>
  readonly checkCommands: ReadonlyArray<string>
}): string =>
  brief([
    opening(Roles.Implementer),
    section("Task", fileText(input.task)),
    rulingsSection(input.rulings),
    section("What to do", whatToDo(implementInstruction, input.checkCommands)),
  ])

/**
 * The reviewer's brief for snapshot `tree`: the tree and `baseRevision`,
 * the `coverage` statement ({@link snapshotCoverage}), the task, the
 * `changedPaths` decoded from `git diff-tree -r --name-status -z`, each
 * path quoted as a JSON string so a newline cannot pass for a new entry,
 * and the last handoff. After the task come the session's owner
 * `rulings` and the rule that a ruling settles its point. It ends with
 * the request for findings.
 */
export const reviewBrief = (input: {
  readonly task: string
  readonly rulings: ReadonlyArray<Ruling>
  readonly tree: Revision
  readonly baseRevision: Revision
  readonly changedPaths: ReadonlyArray<ChangedPath>
  readonly lastHandoff: string
  readonly coverage: string
}): string =>
  brief([
    opening(Roles.Reviewer),
    reviewScope(input.tree, input.baseRevision),
    section("Coverage", input.coverage),
    section("Task", fileText(input.task)),
    `${rulingsSection(input.rulings)}${paragraphBreak}${rulingsSettle}`,
    section("Changed paths", changesText(input.changedPaths)),
    section("Handoff from the previous step", fileText(input.lastHandoff)),
    section("Your reply", findingsRequest),
  ])

/**
 * The corrector's brief for snapshot `tree`: the task, the session's
 * owner `rulings`, the owner's findings file (the only findings a
 * corrector sees) and the prior handoff, then the instruction, which
 * ends with the check commands line when `checkCommands` is non-empty,
 * as in {@link implementBrief}.
 */
export const correctBrief = (input: {
  readonly task: string
  readonly rulings: ReadonlyArray<Ruling>
  readonly findingsFile: string
  readonly priorHandoff: string
  readonly tree: Revision
  readonly checkCommands: ReadonlyArray<string>
}): string =>
  brief([
    opening(Roles.Corrector),
    correctScope(input.tree),
    section("Task", fileText(input.task)),
    rulingsSection(input.rulings),
    section("Findings to address", fileText(input.findingsFile)),
    section("Handoff from the previous step", fileText(input.priorHandoff)),
    section("What to do", whatToDo(correctInstruction, input.checkCommands)),
  ])

/** Paragraphs joined by blank lines, ending in one newline. */
const brief = (paragraphs: ReadonlyArray<string>) =>
  `${Array.join(paragraphs, paragraphBreak)}${lineBreak}`

/** The first paragraph: the role, and that the session is fresh. */
const opening = (role: Role) =>
  `You are the ${role} for one task in this repository.\n${freshSession}`

/** A second-level heading and its body. */
const section = (heading: string, body: string) =>
  `## ${heading}${paragraphBreak}${body}`

/** A file's contents without trailing whitespace, or a mark if empty. */
const fileText = (contents: string) =>
  String.isEmpty(String.trimEnd(contents))
    ? emptyText
    : String.trimEnd(contents)

/** What the reviewer reviews, against what, and that it changes nothing. */
const reviewScope = (tree: Revision, base: Revision) =>
  `You review tree ${tree}, a snapshot of the working directory, against\n` +
  `base revision ${base}. The working directory holds that tree. Do not\n` +
  "change anything in it."

/** What the corrector corrects. */
const correctScope = (tree: Revision) =>
  `You correct tree ${tree}. The working directory holds that tree, and\n` +
  "the owner's findings below were made against it."

/** The changed paths, one per line, or the statement that there are none. */
const changesText = (changes: ReadonlyArray<ChangedPath>) =>
  Array.isReadonlyArrayNonEmpty(changes)
    ? `${changesIntroduction}${paragraphBreak}${changeLines(changes)}`
    : noChanges

/** One line per change. */
const changeLines = (changes: ReadonlyArray<ChangedPath>) =>
  Array.join(Array.map(changes, changeLine), lineBreak)

/** One change: its status, then its source and path for a rename or copy. */
const changeLine = (change: ChangedPath) =>
  Option.match(change.source, {
    onNone: () => `- ${change.status} ${quoted(change.path)}`,
    onSome: (source) =>
      `- ${change.status} ${quoted(source)} -> ${quoted(change.path)}`,
  })

/** A path as a JSON string. */
const quoted = (path: string) => Formatter.formatJson(path)
