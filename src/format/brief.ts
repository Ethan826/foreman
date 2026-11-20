// The text each client receives (plan "Profiles, environment and
// briefs"): implement takes the task file; review takes the task, the
// tree id, the base revision, the changed paths, the last handoff, the
// coverage statement, and asks for a fenced JSON findings block; correct
// takes the task, the owner's findings file, the prior handoff and the
// tree id. Program reads the recorded files and passes their contents;
// these functions do no I/O and write nothing into a brief that was not
// passed in, apart from their own fixed wording. Every brief says the
// agent works in a fresh session, since each step starts a new client
// with no earlier transcript (design: context is renewed every step).
import { Array, Formatter, Option, String } from "effect"
import type { Revision } from "../domain/ids.ts"
import { Roles, type Role } from "../domain/roles.ts"
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
 * accepts, with an example in that shape, and the rule that an empty
 * array requests no changes (plan "Outcomes and usable attempts").
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
  "An empty array, [], means you request no changes.",
], lineBreak)

/** The implementer's brief: the task file's contents and the instruction. */
export const implementBrief = (input: { readonly task: string }): string =>
  brief([
    opening(Roles.Implementer),
    section("Task", fileText(input.task)),
    section("What to do", implementInstruction),
  ])

/**
 * The reviewer's brief for snapshot `tree`: the tree and `baseRevision`,
 * the `coverage` statement ({@link snapshotCoverage}), the task, the
 * `changedPaths` decoded from `git diff-tree -r --name-status -z`, each
 * path quoted as a JSON string so a newline cannot pass for a new entry,
 * and the last handoff. It ends with the request for findings.
 */
export const reviewBrief = (input: {
  readonly task: string
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
    section("Changed paths", changesText(input.changedPaths)),
    section("Handoff from the previous step", fileText(input.lastHandoff)),
    section("Your reply", findingsRequest),
  ])

/**
 * The corrector's brief for snapshot `tree`: the task, the owner's
 * findings file (the only findings a corrector sees) and the prior
 * handoff, then the instruction.
 */
export const correctBrief = (input: {
  readonly task: string
  readonly findingsFile: string
  readonly priorHandoff: string
  readonly tree: Revision
}): string =>
  brief([
    opening(Roles.Corrector),
    correctScope(input.tree),
    section("Task", fileText(input.task)),
    section("Findings to address", fileText(input.findingsFile)),
    section("Handoff from the previous step", fileText(input.priorHandoff)),
    section("What to do", correctInstruction),
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
