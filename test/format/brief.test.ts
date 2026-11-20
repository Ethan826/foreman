// The briefs each client receives (plan "Profiles, environment and
// briefs", "Snapshot identity and raw checks"): exact text built only
// from the recorded inputs passed in.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result } from "effect"
import { Revision } from "../../src/domain/ids.ts"
import {
  correctBrief,
  implementBrief,
  reviewBrief,
  snapshotCoverage,
} from "../../src/format/brief.ts"
import { decodeFindingsBlock } from "../../src/format/findings.ts"
import type { ChangedPath } from "../../src/format/name-status.ts"

const tree = Revision.make("4b825dc642cb6eb9a060e54bf8d69288fbee4904")
const base = Revision.make("78981922613b2afb6025042ff6bd878ac1994e85")

const single = (status: string, path: string): ChangedPath => ({
  status,
  source: Option.none(),
  path,
})

const moved = (status: string, source: string, path: string): ChangedPath => ({
  status,
  source: Option.some(source),
  path,
})

const fresh =
  "You work in a fresh session: you have no transcript of any earlier\n" +
  "session, and everything you need is in this brief."

describe("implementBrief", () => {
  it("gives the task and asks for a handoff", () => {
    expect(implementBrief({ task: "Add a greeting.\n" })).toBe(
      `You are the implementer for one task in this repository.
${fresh}

## Task

Add a greeting.

## What to do

Carry out the task in the working directory. Do not commit. End your
reply with a short handoff: what you changed, what you left undone, and
what the reviewer should check.
`,
    )
  })

  it("marks an empty task file as empty", () => {
    expect(implementBrief({ task: "" })).toContain("## Task\n\n(empty)\n")
  })
})

const reviewInput = {
  task: "Add a greeting.\n",
  tree,
  baseRevision: base,
  changedPaths: [single("M", "src/a b.ts"), moved("R100", "old", "new\nline")],
  lastHandoff: "Added greet().\n",
  coverage: snapshotCoverage,
}

const expectedReview = `You are the reviewer for one task in this repository.
${fresh}

You review tree ${tree}, a snapshot of the working directory, against
base revision ${base}. The working directory holds that tree. Do not
change anything in it.

## Coverage

The tree covers tracked files and untracked files that git does not
ignore. It does not cover ignored files, empty directories, anything
outside the working directory, or the git directory.

## Task

Add a greeting.

## Changed paths

From \`git diff-tree -r --name-status\` between the base revision and the
tree, each path as a JSON string:

- M "src/a b.ts"
- R100 "old" -> "new\\nline"

## Handoff from the previous step

Added greet().

## Your reply

Review the changes against the task. End your reply with a fenced code
block tagged json that holds an array of findings. Each finding is an
object with "id", "severity", an optional "file" and "summary", and
every value is a non-empty string. For example:

\`\`\`json
[
  {
    "id": "F1",
    "severity": "major",
    "file": "src/example.ts",
    "summary": "What is wrong, and why."
  }
]
\`\`\`

An empty array, [], means you request no changes.
`

describe("reviewBrief", () => {
  it("states tree, base, coverage, changes, handoff; asks for findings", () => {
    expect(reviewBrief(reviewInput)).toBe(expectedReview)
  })

  it("says so when no path changed", () => {
    expect(reviewBrief({ ...reviewInput, changedPaths: [] })).toContain(
      "## Changed paths\n\n" +
        "No path changed between the base revision and the tree.\n",
    )
  })

  it("marks an empty handoff as empty", () => {
    expect(reviewBrief({ ...reviewInput, lastHandoff: "" })).toContain(
      "## Handoff from the previous step\n\n(empty)\n",
    )
  })

  it("asks for exactly the shape the findings decoder accepts", () => {
    expect(decodeFindingsBlock(reviewBrief(reviewInput))).toEqual(
      Result.succeed([
        {
          id: "F1",
          severity: "major",
          file: Option.some("src/example.ts"),
          summary: "What is wrong, and why.",
        },
      ]),
    )
  })

  it("decodes a reply in that shape, and [] as no findings", () => {
    const reply = (body: string) =>
      `Looks fine.\n\n\`\`\`json\n${body}\n\`\`\`\n`
    const one = '[{ "id": "R1", "severity": "minor", "summary": "Typo." }]'
    expect(decodeFindingsBlock(reply(one))).toEqual(
      Result.succeed([
        { id: "R1", severity: "minor", file: Option.none(), summary: "Typo." },
      ]),
    )
    expect(decodeFindingsBlock(reply("[]"))).toEqual(Result.succeed([]))
  })
})

describe("correctBrief", () => {
  it("gives the tree, task, the owner's findings and the prior handoff", () => {
    const brief = correctBrief({
      task: "Add a greeting.\n",
      findingsFile: "# Findings\n\n## F1 (major)\n\nWrong name.\n",
      priorHandoff: "No changes requested? No: one finding.\n",
      tree,
    })
    expect(brief).toBe(`You are the corrector for one task in this repository.
${fresh}

You correct tree ${tree}. The working directory holds that tree, and
the owner's findings below were made against it.

## Task

Add a greeting.

## Findings to address

# Findings

## F1 (major)

Wrong name.

## Handoff from the previous step

No changes requested? No: one finding.

## What to do

Address each finding in the working directory. Do not commit. End your
reply with a short handoff: what you changed for each finding and what
you left open.
`)
  })
})

describe("briefs hold only their inputs", () => {
  const marked = {
    task: "TASK-MARK",
    lastHandoff: "HANDOFF-MARK",
    priorHandoff: "PRIOR-MARK",
    findingsFile: "FINDINGS-MARK",
    changed: "PATH-MARK",
  }
  const without = (text: string, given: ReadonlyArray<string>) =>
    given.reduce((rest, each) => rest.split(each).join(""), text)
  const strayInput = /MARK|[0-9a-f]{40}/

  it("leaves no other input or object id once its own are removed", () => {
    const implement = implementBrief({ task: marked.task })
    const review = reviewBrief({
      ...reviewInput,
      task: marked.task,
      lastHandoff: marked.lastHandoff,
      changedPaths: [single("A", marked.changed)],
    })
    const correct = correctBrief({ ...marked, tree })
    expect(without(implement, [marked.task])).not.toMatch(strayInput)
    const reviewGiven = [
      marked.task, marked.lastHandoff, marked.changed, tree, base,
    ]
    const correctGiven = [
      marked.task, marked.findingsFile, marked.priorHandoff, tree,
    ]
    expect(without(review, reviewGiven)).not.toMatch(strayInput)
    expect(without(correct, correctGiven)).not.toMatch(strayInput)
  })
})
