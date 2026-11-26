// The "Owner rulings" section of every brief (v0.2.0 design, "Briefs";
// dogfood-6b, owner ruling 7): right after the task, one entry per ruling
// in order, `R1: <text>`, with `(supersedes Rn)` and `(superseded by Rm)`
// after the id (both, supersedes first, when a ruling is both), entries
// separated by a blank line; the review brief then adds the sentence that
// a ruling settles its point. The implement, review and correct briefs
// are each checked, so a brief kind that drops the section fails.
import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { Revision, RulingId } from "../../src/domain/ids.ts"
import type { Ruling } from "../../src/domain/rulings.ts"
import { correctBrief, implementBrief, reviewBrief, snapshotCoverage } from "../../src/format/brief.ts"

const tree = Revision.make("4b825dc642cb6eb9a060e54bf8d69288fbee4904")
const base = Revision.make("78981922613b2afb6025042ff6bd878ac1994e85")
const id = (n: number) => RulingId.make(`R${String(n)}`)

/** R1 superseded by R3; R2 plain, over two lines; R3 superseding R1 and superseded by R4; R4 superseding R3. */
const rulings: ReadonlyArray<Ruling> = [
  { id: id(1), text: "Keep the greeting short.", supersedes: Option.none(), supersededBy: Option.some(id(3)) },
  { id: id(2), text: "Write in English.\nNo other language.", supersedes: Option.none(), supersededBy: Option.none() },
  { id: id(3), text: "Any length will do.", supersedes: Option.some(id(1)), supersededBy: Option.some(id(4)) },
  { id: id(4), text: "Two sentences at most.", supersedes: Option.some(id(3)), supersededBy: Option.none() },
]

/** The section every brief gives for `rulings`, between the task and the next section. */
const section =
  "## Owner rulings\n\n" +
  "R1 (superseded by R3): Keep the greeting short.\n\n" +
  "R2: Write in English.\nNo other language.\n\n" +
  "R3 (supersedes R1) (superseded by R4): Any length will do.\n\n" +
  "R4 (supersedes R3): Two sentences at most."

const settles =
  "A ruling settles its point. A finding that contradicts a ruling must cite the ruling's id " +
  "and say why the ruling does not cover the case, or be left out."

const implement = implementBrief({ task: "Add a greeting.\n", rulings, checkCommands: [] })
const review = reviewBrief({
  task: "Add a greeting.\n",
  rulings,
  tree,
  baseRevision: base,
  changedPaths: [],
  lastHandoff: "Done.\n",
  coverage: snapshotCoverage,
})
const correct = correctBrief({
  task: "Add a greeting.\n",
  rulings,
  findingsFile: "Wrong name.\n",
  priorHandoff: "Done.\n",
  tree,
  checkCommands: [],
})

describe("the Owner rulings section", () => {
  it("in the implement brief, lists every ruling with its marks right after the task", () => {
    expect(implement).toContain(`## Task\n\nAdd a greeting.\n\n${section}\n\n## What to do\n`)
  })

  it("in the review brief, lists every ruling, then the sentence that a ruling settles its point", () => {
    expect(review).toContain(`## Task\n\nAdd a greeting.\n\n${section}\n\n${settles}\n\n## Changed paths\n`)
  })

  it("in the correct brief, lists every ruling with its marks right after the task", () => {
    expect(correct).toContain(`## Task\n\nAdd a greeting.\n\n${section}\n\n## Findings to address\n`)
  })

  it("says None. in every brief when there is no ruling, and the review brief still adds the sentence", () => {
    const none = "## Owner rulings\n\nNone.\n\n"
    expect(implementBrief({ task: "T.\n", rulings: [], checkCommands: [] })).toContain(`${none}## What to do`)
    expect(
      reviewBrief({ task: "T.\n", rulings: [], tree, baseRevision: base, changedPaths: [], lastHandoff: "", coverage: snapshotCoverage }),
    ).toContain(`${none}${settles}\n\n## Changed paths`)
    expect(
      correctBrief({ task: "T.\n", rulings: [], findingsFile: "F.\n", priorHandoff: "", tree, checkCommands: [] }),
    ).toContain(`${none}## Findings to address`)
  })

  it("the implement and correct briefs carry no sentence about findings and rulings", () => {
    expect(implement).not.toContain(settles)
    expect(correct).not.toContain(settles)
  })
})
