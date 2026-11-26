// The session fold's rulings, findings and overrules, and the pure
// helpers the rules and briefs ask (v0.2.0, dogfood-6b, owner rulings 2
// and 5): rulings in session order with both supersede marks, findings
// and overrules named by review and finding id together, events of
// another session ignored.
import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import type { ProjectEvent } from "../../src/domain/events.ts"
import { FindingOverruled, FindingsRecorded, RulingAdded } from "../../src/domain/events.ts"
import { ChangesRequested } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import { SessionId } from "../../src/domain/session.ts"
import type { OpenSession } from "../../src/domain/session-state.ts"
import {
  everyFindingOverruled,
  isOverruled,
  nextRulingId,
  overruleText,
  recordedFinding,
  recordedFindings,
  rulingOf,
  someFindingOverruled,
} from "../../src/features/rulings.ts"
import { awaitsClose, awaitsReReview, openSessionOf } from "../../src/features/session-phases.ts"
import { foldSession } from "../../src/features/session.ts"
import { changesAsked, implemented, reviewClean } from "./command-fixtures.ts"
import { finding, overruled, recorded, ruled, rulingId } from "./rulings-fixtures.ts"
import { approved, finished, intended, opened, opId } from "./session-fixtures.ts"

/** An open session with nothing in it, returned only after `sessionOf` has already failed the test. */
const emptySession: OpenSession = {
  opened: opened(),
  attempts: [],
  reports: [],
  corrections: 0,
  reviewedTree: Option.none(),
  rulings: [],
  findings: [],
  overrules: [],
}

/** The open session the log folds to; fails the test when none is open. */
const sessionOf = (log: ReadonlyArray<ProjectEvent>): OpenSession => {
  const session = openSessionOf(foldSession(log).state)
  expect(Option.isSome(session)).toBe(true)
  return Option.getOrElse(session, () => emptySession)
}

const twoFindings = [...changesAsked, recorded(2, ["F1", "F2"])]
const bothOverruled = [...twoFindings, ...overruled(2, "F1", 1), ...overruled(2, "F2", 2)]

describe("the fold's rulings", () => {
  it("starts an open session with no ruling, finding or overrule", () => {
    const session = sessionOf([opened()])
    expect([session.rulings, session.findings, session.overrules]).toEqual([[], [], []])
  })

  it("keeps rulings in order, and marks both ends of a supersession", () => {
    const session = sessionOf([opened(), ruled(1), ruled(2), ruled(3, Option.some(1)), ruled(4, Option.some(3))])
    expect(session.rulings).toEqual([
      { id: rulingId(1), text: "Ruling 1.", supersedes: Option.none(), supersededBy: Option.some(rulingId(3)) },
      { id: rulingId(2), text: "Ruling 2.", supersedes: Option.none(), supersededBy: Option.none() },
      { id: rulingId(3), text: "Ruling 3.", supersedes: Option.some(rulingId(1)), supersededBy: Option.some(rulingId(4)) },
      { id: rulingId(4), text: "Ruling 4.", supersedes: Option.some(rulingId(3)), supersededBy: Option.none() },
    ])
  })

  it("keeps the findings and the overrules of each review", () => {
    const session = sessionOf(bothOverruled)
    expect(session.findings).toEqual([recorded(2, ["F1", "F2"])])
    expect(session.overrules).toEqual([
      { reviewOpId: opId(2), findingId: "F1", rulingId: rulingId(1) },
      { reviewOpId: opId(2), findingId: "F2", rulingId: rulingId(2) },
    ])
  })

  it("ignores rulings, findings and overrules naming another session", () => {
    const other = SessionId.make("s-2")
    const elsewhere = [
      new RulingAdded({ sessionId: other, rulingId: rulingId(3), text: "Elsewhere.", supersedes: Option.some(rulingId(1)) }),
      new FindingsRecorded({ sessionId: other, reviewOpId: opId(2), findings: [finding("F3")] }),
      new FindingOverruled({ sessionId: other, reviewOpId: opId(2), findingId: "F3", rulingId: rulingId(3), note: "Elsewhere." }),
    ]
    const fresh = sessionOf([...changesAsked, ...elsewhere])
    expect([fresh.rulings, fresh.findings, fresh.overrules]).toEqual([[], [], []])
    const kept = sessionOf([...bothOverruled, ...elsewhere])
    expect(kept.rulings).toEqual([
      { id: rulingId(1), text: "Ruling 1.", supersedes: Option.none(), supersededBy: Option.none() },
      { id: rulingId(2), text: "Ruling 2.", supersedes: Option.none(), supersededBy: Option.none() },
    ])
    expect(kept.findings).toEqual([recorded(2, ["F1", "F2"])])
    expect(kept.overrules).toEqual([
      { reviewOpId: opId(2), findingId: "F1", rulingId: rulingId(1) },
      { reviewOpId: opId(2), findingId: "F2", rulingId: rulingId(2) },
    ])
  })

  it("forgets the rulings of a closed session when the next one opens", () => {
    const session = sessionOf([opened(), ruled(1), opened(SessionId.make("s-2"))])
    expect(session.rulings).toEqual([])
  })
})

describe("nextRulingId", () => {
  it("is R1 first, and counts every ruling, an overrule's included", () => {
    expect(nextRulingId(sessionOf([opened()]))).toBe(rulingId(1))
    expect(nextRulingId(sessionOf([...twoFindings, ruled(1), ...overruled(2, "F1", 2)]))).toBe(rulingId(3))
  })
})

describe("rulingOf", () => {
  it("finds a recorded ruling and nothing else", () => {
    const session = sessionOf([opened(), ruled(1)])
    expect(Option.map(rulingOf(session, rulingId(1)), (ruling) => ruling.text)).toEqual(Option.some("Ruling 1."))
    expect(rulingOf(session, rulingId(2))).toEqual(Option.none())
  })
})

describe("recordedFindings and recordedFinding", () => {
  it("read a review's findings by its opId, and none for a review that recorded none", () => {
    const session = sessionOf(twoFindings)
    expect(recordedFindings(session, opId(2))).toEqual(Option.some([finding("F1"), finding("F2")]))
    expect(recordedFindings(session, opId(1))).toEqual(Option.none())
    expect(recordedFinding(session, opId(2), "F2")).toEqual(Option.some(finding("F2")))
    expect(recordedFinding(session, opId(2), "F3")).toEqual(Option.none())
    expect(recordedFindings(sessionOf(changesAsked), opId(2))).toEqual(Option.none())
  })
})

/** Review A (op-2) with F1 and F2 fully overruled, then a re-review B (op-3) reporting F1 again. */
const reReviewed = [
  ...bothOverruled,
  approved(2, Roles.Reviewer),
  intended(3, Roles.Reviewer),
  finished(3, new ChangesRequested()),
  recorded(3, ["F1"]),
]

describe("isOverruled, everyFindingOverruled and someFindingOverruled", () => {
  it("name a finding by its review and its id together", () => {
    const session = sessionOf(reReviewed)
    expect(isOverruled(session, opId(2), "F1")).toBe(true)
    expect(isOverruled(session, opId(3), "F1")).toBe(false)
    expect(everyFindingOverruled(session, opId(2))).toBe(true)
    expect(everyFindingOverruled(session, opId(3))).toBe(false)
    expect(someFindingOverruled(session, opId(3))).toBe(false)
  })

  it("tell every from some on a two-finding review", () => {
    const one = sessionOf([...twoFindings, ...overruled(2, "F2", 1)])
    expect(someFindingOverruled(one, opId(2))).toBe(true)
    expect(everyFindingOverruled(one, opId(2))).toBe(false)
    expect(someFindingOverruled(sessionOf(twoFindings), opId(2))).toBe(false)
  })

  it("never hold for a review with no findings recorded", () => {
    const session = sessionOf([...reviewClean, recorded(2, [])])
    expect(everyFindingOverruled(session, opId(2))).toBe(false)
    expect(someFindingOverruled(session, opId(2))).toBe(false)
  })

  it("keep a finding overruled after its ruling is superseded", () => {
    const session = sessionOf([...bothOverruled, ruled(3, Option.some(1))])
    expect(isOverruled(session, opId(2), "F1")).toBe(true)
    expect(everyFindingOverruled(session, opId(2))).toBe(true)
  })
})

describe("overruleText", () => {
  it("quotes the finding's id, its review, the note and the finding's summary exactly", () => {
    expect(overruleText(opId(2), finding("F1"), "It is intended.")).toBe(
      "Finding F1 of review op-2 is overruled: It is intended. (the finding: The summary of F1.)",
    )
  })
})

describe("awaitsClose and awaitsReReview", () => {
  const stateOf = (log: ReadonlyArray<ProjectEvent>) => foldSession(log).state

  it("awaitsClose holds after a clean review and after every finding is overruled, not after one", () => {
    expect(awaitsClose(stateOf(reviewClean))).toBe(true)
    expect(awaitsClose(stateOf(bothOverruled))).toBe(true)
    expect(awaitsClose(stateOf([...twoFindings, ...overruled(2, "F1", 1)]))).toBe(false)
    expect(awaitsClose(stateOf(twoFindings))).toBe(false)
    expect(awaitsClose(stateOf(changesAsked))).toBe(false)
    expect(awaitsClose(stateOf(implemented))).toBe(false)
  })

  it("awaitsReReview holds after one overrule of a review that asked for changes, and not before", () => {
    expect(awaitsReReview(stateOf([...twoFindings, ...overruled(2, "F1", 1)]))).toBe(true)
    expect(awaitsReReview(stateOf(twoFindings))).toBe(false)
    expect(awaitsReReview(stateOf([...reviewClean, recorded(2, [])]))).toBe(false)
    expect(awaitsReReview(stateOf(implemented))).toBe(false)
  })

  it("follow the awaited review, not an earlier one with the same finding ids", () => {
    expect(awaitsClose(stateOf(reReviewed))).toBe(false)
    expect(awaitsReReview(stateOf(reReviewed))).toBe(false)
    expect(awaitsClose(stateOf([...reReviewed, ...overruled(3, "F1", 3)]))).toBe(true)
  })
})
