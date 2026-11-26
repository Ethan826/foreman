// `ruling add`, `overrule`, and the close and re-review rules they open
// (v0.2.0 design, "Commands and events", "Closing after overrules";
// dogfood-6b, owner rulings 4 to 6). Each fact is tested against the
// counterexample its table names: every state for `ruling add`, an
// earlier ruling as well as the latest, each refused kind of review for
// `overrule`, a two-finding review for "every" against "any", a changed
// tree, and finding ids that repeat across reviews.
import { describe, expect, it } from "@effect/vitest"
import { Option, String as Str } from "effect"
import type { ProjectEvent } from "../../src/domain/events.ts"
import { Revision } from "../../src/domain/ids.ts"
import { ChangesRequested, Crashed } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import {
  AddRuling,
  CloseKinds,
  Correct,
  Overrule,
  Review,
  SessionClose,
  type SessionCommand,
} from "../../src/domain/session.ts"
import {
  type CommandChecks,
  FindingNotRecorded,
  FindingOverruledAlready,
  RulingSuperseded,
  RulingUnknown,
  TreeChanged,
} from "../../src/features/command-rules.ts"
import {
  allowedIn,
  broken,
  changesAsked,
  codex,
  decide,
  good,
  implemented,
  implementing,
  interrupted,
  lockNotHeld,
  ok,
  refusals,
  reviewClean,
  reviewing,
  wasRejected,
  wrongState,
} from "./command-fixtures.ts"
import { overruled, recorded, ruled, rulingId } from "./rulings-fixtures.ts"
import { approved, finished, intended, opened, treeA, treeB } from "./session-fixtures.ts"

const addRuling = (supersedes: Option.Option<number> = Option.none()) =>
  new AddRuling({ supersedes: Option.map(supersedes, rulingId) })
const overrule = (findingId: string) => new Overrule({ findingId })
const closeFinished = new SessionClose({ how: CloseKinds.Finished })

/** The checks with a snapshot of `tree`, which passed the raw checks. */
const snapshotOf = (checks: CommandChecks, tree: Revision): CommandChecks => ({
  ...checks,
  snapshot: Option.some({ tree, passedRawChecks: true }),
})

/** A HEAD that is not the fixtures' session base. */
const movedHead = Revision.make(Str.repeat(40)("e"))

const twoFindings = [...changesAsked, recorded(2, ["F1", "F2"])]
const oneOverruled = [...twoFindings, ...overruled(2, "F1", 1)]
const bothOverruled = [...oneOverruled, ...overruled(2, "F2", 2)]

describe("ruling add", () => {
  it("is allowed in every open state with no incomplete attempt, and in no other", () => {
    expect(allowedIn(addRuling())).toEqual([
      "open, no attempt",
      "usable implement",
      "unusable implement",
      "review with changes",
      "clean review",
      "unclassified review",
      "usable correct",
      "rejected",
    ])
  })

  it("is allowed in OpenNoAttempt, AwaitingHandoff and Rejected", () => {
    expect(decide(addRuling(), [opened()])).toEqual(ok)
    expect(decide(addRuling(), implemented)).toEqual(ok)
    expect(decide(addRuling(), wasRejected)).toEqual(ok)
  })

  it("is refused with no session, with an incomplete attempt and when Interrupted", () => {
    expect(refusals(addRuling(), [])).toEqual([wrongState([])])
    expect(refusals(addRuling(), implementing)).toEqual([wrongState(implementing)])
    expect(refusals(addRuling(), interrupted)).toEqual([wrongState(interrupted)])
  })

  it("needs the lock and nothing the launches need", () => {
    expect(refusals(addRuling(), implemented, { ...good, lockHeld: false })).toEqual([lockNotHeld])
    expect(decide(addRuling(), implemented, broken)).toEqual(ok)
  })

  it("supersedes an earlier ruling as well as the latest", () => {
    const three = [opened(), ruled(1), ruled(2), ruled(3)]
    expect(decide(addRuling(Option.some(1)), three)).toEqual(ok)
    expect(decide(addRuling(Option.some(2)), three)).toEqual(ok)
    expect(decide(addRuling(Option.some(3)), three)).toEqual(ok)
  })

  it("refuses to supersede a ruling not recorded in this session", () => {
    expect(refusals(addRuling(Option.some(1)), [opened()])).toEqual([new RulingUnknown({ rulingId: rulingId(1) })])
    expect(refusals(addRuling(Option.some(4)), [opened(), ruled(1), ruled(2), ruled(3)])).toEqual([
      new RulingUnknown({ rulingId: rulingId(4) }),
    ])
  })

  it("refuses to supersede an earlier ruling already superseded", () => {
    const superseded = [opened(), ruled(1), ruled(2), ruled(3, Option.some(1))]
    expect(refusals(addRuling(Option.some(1)), superseded)).toEqual([
      new RulingSuperseded({ rulingId: rulingId(1) }),
    ])
    expect(decide(addRuling(Option.some(3)), superseded)).toEqual(ok)
  })
})

describe("overrule", () => {
  it("is allowed for a recorded finding of a review that asked for changes", () => {
    expect(decide(overrule("F1"), twoFindings)).toEqual(ok)
    expect(decide(overrule("F2"), oneOverruled)).toEqual(ok)
  })

  it("needs the lock and nothing the launches need", () => {
    expect(refusals(overrule("F1"), twoFindings, { ...good, lockHeld: false })).toEqual([lockNotHeld])
    expect(decide(overrule("F1"), twoFindings, broken)).toEqual(ok)
  })

  it("is refused for a crashed review, a Success review and an implement awaiting handoff", () => {
    const crashed = [...reviewing, finished(2, new Crashed({ signal: "SIGKILL" })), recorded(2, ["F1"])]
    const clean = [...reviewClean, recorded(2, [])]
    expect(refusals(overrule("F1"), crashed)).toEqual([wrongState(crashed)])
    expect(refusals(overrule("F1"), clean)).toEqual([wrongState(clean)])
    expect(refusals(overrule("F1"), implemented)).toEqual([wrongState(implemented)])
  })

  it("is refused for a finding id the review did not record", () => {
    expect(refusals(overrule("F3"), twoFindings)).toEqual([new FindingNotRecorded({ findingId: "F3" })])
  })

  it("is refused for a review with no FindingsRecorded, as one run before dogfood-6", () => {
    expect(refusals(overrule("F1"), changesAsked)).toEqual([new FindingNotRecorded({ findingId: "F1" })])
  })

  it("is refused for a finding already overruled", () => {
    expect(refusals(overrule("F1"), oneOverruled)).toEqual([new FindingOverruledAlready({ findingId: "F1" })])
  })
})

describe("close --finished after overrules", () => {
  it("is allowed once both findings of a two-finding review are overruled", () => {
    expect(decide(closeFinished, bothOverruled)).toEqual(ok)
  })

  it("is refused after only one of the two is overruled, and before any", () => {
    expect(refusals(closeFinished, oneOverruled)).toEqual([wrongState(oneOverruled)])
    expect(refusals(closeFinished, twoFindings)).toEqual([wrongState(twoFindings)])
  })

  it("still refuses a changed tree once every finding is overruled", () => {
    expect(refusals(closeFinished, bothOverruled, snapshotOf(good, treeB))).toEqual([
      new TreeChanged({ reviewed: Option.some(treeA), current: treeB }),
    ])
  })

  it("is never allowed for an unusable review", () => {
    const crashed = [...reviewing, finished(2, new Crashed({ signal: "SIGKILL" }))]
    expect(refusals(closeFinished, crashed)).toEqual([wrongState(crashed)])
  })
})

describe("review again after an overrule", () => {
  it("is allowed on the reviewed tree after one overrule", () => {
    expect(decide(new Review(), oneOverruled, codex)).toEqual(ok)
  })

  it("is refused on a changed tree", () => {
    expect(refusals(new Review(), oneOverruled, snapshotOf(codex, treeB))).toEqual([
      new TreeChanged({ reviewed: Option.some(treeA), current: treeB }),
    ])
  })

  it("is refused without an overrule, as before", () => {
    expect(refusals(new Review(), twoFindings, codex)).toEqual([wrongState(twoFindings)])
    expect(refusals(new Review(), changesAsked, codex)).toEqual([wrongState(changesAsked)])
  })

  it("after an edit still needs only a snapshot that passes, on any tree", () => {
    expect(decide(new Review(), implemented, snapshotOf(codex, treeB))).toEqual(ok)
  })
})

describe("correct after a partial overrule", () => {
  it("stays allowed", () => {
    expect(decide(new Correct(), oneOverruled)).toEqual(ok)
  })
})

/** Review A (op-2) with F1 and F2 overruled, then a re-review B (op-3) reporting F1 again. */
const reReviewed: ReadonlyArray<ProjectEvent> = [
  ...bothOverruled,
  approved(2, Roles.Reviewer),
  intended(3, Roles.Reviewer),
  finished(3, new ChangesRequested()),
  recorded(3, ["F1"]),
]

describe("finding ids per review", () => {
  it("allows overruling F1 of the re-review after F1 of the earlier review was overruled", () => {
    expect(decide(overrule("F1"), reReviewed)).toEqual(ok)
  })

  it("refuses close --finished until the re-review's F1 is overruled", () => {
    expect(refusals(closeFinished, reReviewed)).toEqual([wrongState(reReviewed)])
    expect(decide(closeFinished, [...reReviewed, ...overruled(3, "F1", 3)])).toEqual(ok)
  })
})

describe("superseding the ruling an overrule added", () => {
  const superseded = [...bothOverruled, ruled(3, Option.some(1))]

  it("leaves the finding overruled: close stays allowed", () => {
    expect(decide(closeFinished, superseded)).toEqual(ok)
  })

  it("and overruling it again is still refused", () => {
    const supersededOne = [...oneOverruled, ruled(2, Option.some(1))]
    expect(refusals(overrule("F1"), supersededOne)).toEqual([new FindingOverruledAlready({ findingId: "F1" })])
  })
})

describe("a moved HEAD", () => {
  const withMovedHead = (checks: CommandChecks): CommandChecks => ({ ...checks, head: Option.some(movedHead) })
  const cases: ReadonlyArray<readonly [string, SessionCommand, ReadonlyArray<ProjectEvent>]> = [
    ["ruling add", addRuling(), implemented],
    ["ruling add --supersedes", addRuling(Option.some(1)), [...implemented, ruled(1)]],
    ["overrule", overrule("F1"), twoFindings],
  ]

  it.each(cases)("does not refuse %s", (_name, command, log) => {
    expect(decide(command, log, withMovedHead(good))).toEqual(ok)
  })
})
