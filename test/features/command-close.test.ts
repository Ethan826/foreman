// The owner's exits in the prerequisite matrix (plan "Commands and their
// prerequisites", AC1, close rules; "Settlement for owner-ended steps"):
// `step-ended` and every kind of `session close`.
import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { CloseKinds, SessionClose, StepEnded } from "../../src/domain/session.ts"
import { AlreadyAttested, NotIncomplete, TreeChanged, WrongGrant } from "../../src/features/command-rules.ts"
import { grantId, launched, opened, opId, treeA, treeB } from "./session-fixtures.ts"
import {
  approval,
  good,
  broken,
  implementing,
  implemented,
  reviewClean,
  interrupted,
  wasClosed,
  decide,
  ok,
  refusals,
  wrongState,
  lockNotHeld,
  notAttested,
  snapshotRefused,
  allowedIn,
} from "./command-fixtures.ts"

describe("step-ended", () => {
  const ended = (n: number, grant = grantId(n)) => new StepEnded({ opId: opId(n), grantId: grant })

  it("is allowed for an incomplete attempt and its grant, launched or not", () => {
    expect(decide(ended(1), implementing)).toEqual(ok)
    expect(decide(ended(1), [...implementing, launched(1)])).toEqual(ok)
  })

  it("needs the lock and nothing else", () => {
    expect(refusals(ended(1), implementing, { ...good, lockHeld: false })).toEqual([lockNotHeld])
    expect(decide(ended(1), implementing, broken)).toEqual(ok)
  })

  it("refuses another attempt's grant", () => {
    expect(refusals(ended(1, grantId(2)), implementing)).toEqual([
      new WrongGrant({ opId: opId(1), grantId: grantId(2) }),
    ])
  })

  it("refuses an unknown or finished attempt", () => {
    expect(refusals(ended(7), implementing)).toEqual([new NotIncomplete({ opId: opId(7) })])
    expect(refusals(ended(1), implemented)).toEqual([new NotIncomplete({ opId: opId(1) })])
  })

  it("refuses a second attestation of the same attempt", () => {
    expect(refusals(ended(1), interrupted)).toEqual([new AlreadyAttested({ opId: opId(1) })])
  })

  it("refuses when no session is open", () => {
    expect(refusals(ended(1), [])).toEqual([wrongState([])])
    expect(refusals(ended(1), wasClosed)).toEqual([wrongState(wasClosed)])
  })
})

describe("session close", () => {
  const close = (how: SessionClose["how"]) => new SessionClose({ how })

  it("--abandoned: any open session with no incomplete attempt, including one with no attempt", () => {
    expect(allowedIn(close(CloseKinds.Abandoned))).toEqual([
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

  it("--abandoned with a failed worktree check, a version mismatch, a missing report and holds", () => {
    expect(decide(close(CloseKinds.Abandoned), implemented, broken)).toEqual(ok)
    expect(decide(close(CloseKinds.Abandoned), [opened()], broken)).toEqual(ok)
  })

  it("--interrupted: only once every incomplete attempt has the owner's attestation", () => {
    expect(allowedIn(close(CloseKinds.Interrupted))).toEqual(["owner-ended"])
    expect(refusals(close(CloseKinds.Interrupted), implementing)).toEqual([wrongState(implementing)])
    expect(decide(close(CloseKinds.Interrupted), interrupted, broken)).toEqual(ok)
  })

  it("--finished: a clean usable review, attested, on the reviewed tree", () => {
    expect(allowedIn(close(CloseKinds.Finished))).toEqual(["clean review"])
    const failing = { ...good, attested: false, snapshot: Option.some({ tree: treeB, passedRawChecks: true }) }
    expect(refusals(close(CloseKinds.Finished), reviewClean, failing)).toEqual([
      notAttested,
      new TreeChanged({ reviewed: Option.some(treeA), current: treeB }),
    ])
    expect(refusals(close(CloseKinds.Finished), reviewClean, { ...good, snapshot: Option.none() })).toEqual([
      snapshotRefused,
    ])
  })

  it("--finished does not need the worktree check, a pin, reports or hold-free state", () => {
    const others = { ...good, worktreeCheckPassed: false, pinMatches: false, reportsIntact: false, holds: [approval] }
    expect(decide(close(CloseKinds.Finished), reviewClean, others)).toEqual(ok)
  })

  it("every kind needs the lock and an open session", () => {
    Object.values(CloseKinds).forEach((how) => {
      expect(refusals(close(how), interrupted, { ...good, lockHeld: false })).toContainEqual(lockNotHeld)
      expect(refusals(close(how), [])).toEqual([wrongState([])])
      expect(refusals(close(how), wasClosed)).toEqual([wrongState(wasClosed)])
    })
  })
})
