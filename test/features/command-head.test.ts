// A moved HEAD in the prerequisite matrix (owner ruling of 2026-11-23,
// dogfood-3a): while a session is open, a supervisor HEAD that differs
// from the session's base refuses `implement`, `review`, `correct` and
// `session close --finished`, and never `reject`, `step-ended`, `session
// close --abandoned`, `session close --interrupted`, `session close
// --unconverged` or `status`. A
// command that read no HEAD passes the rule.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option, String as Str } from "effect"
import { Revision } from "../../src/domain/ids.ts"
import type { ProjectEvent } from "../../src/domain/events.ts"
import {
  CloseKinds,
  Correct,
  Implement,
  Reject,
  Review,
  SessionClose,
  type SessionCommand,
  Status,
  StepEnded,
} from "../../src/domain/session.ts"
import { type CommandChecks, HeadMoved } from "../../src/features/command-rules.ts"
import { movedHead } from "../../src/features/command-refusals.ts"
import { foldSession } from "../../src/features/session.ts"
import { base, grantId, opened, opId } from "./session-fixtures.ts"
import {
  changesAsked,
  codex,
  decide,
  good,
  implemented,
  implementing,
  interrupted,
  ok,
  refusals,
  reviewClean,
  twiceCorrected,
  wasClosed,
} from "./command-fixtures.ts"

/** A HEAD that is not the fixtures' session base. */
const moved = Revision.make(Str.repeat(40)("e"))

/** `checks` with the moved HEAD read. */
const withMovedHead = (checks: CommandChecks): CommandChecks => ({ ...checks, head: Option.some(moved) })

/** The refusal naming the fixtures' base and the moved HEAD. */
const headMoved = new HeadMoved({ base, head: moved })

/** One command in a state where every other prerequisite holds, with the checks it is decided with. */
interface Case {
  readonly name: string
  readonly command: SessionCommand
  readonly log: ReadonlyArray<ProjectEvent>
  readonly checks: CommandChecks
}

const refusedCases: ReadonlyArray<Case> = [
  { name: "implement", command: new Implement(), log: [opened()], checks: good },
  { name: "review", command: new Review(), log: implemented, checks: codex },
  { name: "correct", command: new Correct(), log: changesAsked, checks: good },
  { name: "close --finished", command: new SessionClose({ how: CloseKinds.Finished }), log: reviewClean, checks: good },
]

const exitCases: ReadonlyArray<Case> = [
  { name: "reject", command: new Reject(), log: implemented, checks: good },
  { name: "step-ended", command: new StepEnded({ opId: opId(1), grantId: grantId(1) }), log: implementing, checks: good },
  { name: "close --abandoned", command: new SessionClose({ how: CloseKinds.Abandoned }), log: implemented, checks: good },
  { name: "close --interrupted", command: new SessionClose({ how: CloseKinds.Interrupted }), log: interrupted, checks: good },
  { name: "close --unconverged", command: new SessionClose({ how: CloseKinds.Unconverged }), log: twiceCorrected, checks: good },
  { name: "status", command: new Status(), log: implemented, checks: good },
]

/** The case is allowed with HEAD on the base, and refused for the moved HEAD alone. */
const refusesMovedHead = (testCase: Case) => () => {
  expect(decide(testCase.command, testCase.log, testCase.checks)).toEqual(ok)
  expect(refusals(testCase.command, testCase.log, withMovedHead(testCase.checks))).toEqual([headMoved])
}

/** The case is allowed with the moved HEAD. */
const ignoresMovedHead = (testCase: Case) => () => {
  expect(decide(testCase.command, testCase.log, withMovedHead(testCase.checks))).toEqual(ok)
}

/** The case is allowed when no HEAD was read. */
const passesWithoutHead = (testCase: Case) => () => {
  expect(decide(testCase.command, testCase.log, { ...testCase.checks, head: Option.none() })).toEqual(ok)
}

describe("a moved HEAD", () => {
  Arr.forEach(refusedCases, (testCase) => {
    it(`refuses ${testCase.name}, naming the base and the HEAD`, refusesMovedHead(testCase))
    it(`does not refuse ${testCase.name} when no HEAD was read`, passesWithoutHead(testCase))
  })
  Arr.forEach(exitCases, (testCase) => {
    it(`never refuses ${testCase.name}`, ignoresMovedHead(testCase))
  })
})

describe("movedHead", () => {
  it("is the refusal while a session is open and the HEAD read differs from its base", () => {
    expect(movedHead(foldSession(implemented).state, Option.some(moved))).toEqual(Option.some(headMoved))
  })

  it("is none on the base, with no HEAD read, or with no session open", () => {
    expect(movedHead(foldSession(implemented).state, Option.some(base))).toEqual(Option.none())
    expect(movedHead(foldSession(implemented).state, Option.none())).toEqual(Option.none())
    expect(movedHead(foldSession([]).state, Option.some(moved))).toEqual(Option.none())
    expect(movedHead(foldSession(wasClosed).state, Option.some(moved))).toEqual(Option.none())
  })
})
