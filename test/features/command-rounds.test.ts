// `rounds grant`, the correction limit it raises and `session close
// --unconverged` (v0.2.0 design, "The correction limit"; dogfood-7, owner
// rulings 2 to 6). Each fact is tested against the counterexample its
// table names: corrections past the default limit up to a refused one,
// so an unlimited counter fails; two sessions, and a grant naming another
// session while one is open; every state for `rounds grant`; the
// refusal's fields, not its tag; and for the close, every refused kind of
// state beside the allowed ones, a review with no `FindingsRecorded`
// included. A grant that would raise the limit past the largest safe
// integer is refused with `RoundsLimitUnsafe`, tested at the bound; a
// hand-edited log whose grants pass it folds to a saturated limit, and
// the rules still return refusals for it rather than throwing.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option, Schema, String as Str } from "effect"
import type { ProjectEvent } from "../../src/domain/events.ts"
import { Revision } from "../../src/domain/ids.ts"
import { ChangesRequested, Success } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import type { OpenSession } from "../../src/domain/session-state.ts"
import {
  CloseKinds,
  Correct,
  GrantRounds,
  SessionClose,
  SessionId,
  SessionOpen,
} from "../../src/domain/session.ts"
import {
  type CommandChecks,
  correctionLimit,
  CorrectionsExhausted,
  CorrectionsRemain,
  maxCorrections,
  RoundsLimitUnsafe,
} from "../../src/features/command-rules.ts"
import { awaitsClose, awaitsUnconverged, openSessionOf } from "../../src/features/session-phases.ts"
import { foldSession } from "../../src/features/session.ts"
import {
  allowedIn,
  broken,
  corrected,
  decide,
  good,
  implemented,
  implementing,
  interrupted,
  lockNotHeld,
  ok,
  refusals,
  twiceCorrected,
  wasClosed,
  wasRejected,
  wrongState,
} from "./command-fixtures.ts"
import { granted, overruled, recorded } from "./rulings-fixtures.ts"
import { approved, closed, finished, intended, opened, rejected } from "./session-fixtures.ts"

const grant = (count: number) => new GrantRounds({ count })
const unconverged = new SessionClose({ how: CloseKinds.Unconverged })
const otherSession = SessionId.make("s-2")

/** A HEAD that is not the fixtures' session base. */
const movedHead = Revision.make(Str.repeat(40)("e"))
const withMovedHead = (checks: CommandChecks): CommandChecks => ({ ...checks, head: Option.some(movedHead) })

/**
 * One more round after review `n` asked for changes: its handoff to the
 * corrector, the correction (attempt n + 1), the handoff to the reviewer
 * and a review (attempt n + 2) that asks for changes again.
 */
const roundAfter = (n: number): ReadonlyArray<ProjectEvent> => [
  approved(n, Roles.Corrector),
  intended(n + 1, Roles.Corrector),
  finished(n + 1, new Success()),
  approved(n + 1, Roles.Reviewer),
  intended(n + 2, Roles.Reviewer),
  finished(n + 2, new ChangesRequested()),
]

/** The fixtures' twice-corrected session (last review op-6), then `grants`, then one round, then another. */
const throughFourCorrections = (grants: ReadonlyArray<ProjectEvent>) => {
  const third = [...twiceCorrected, ...grants]
  const fourth = [...third, ...roundAfter(6)]
  const fifth = [...fourth, ...roundAfter(8)]
  return { third, fourth, fifth }
}

/** The open session's facts, or none. */
const sessionOf = (log: ReadonlyArray<ProjectEvent>): Option.Option<OpenSession> =>
  openSessionOf(foldSession(log).state)

/** The open session's correction limit, or none with no session open. */
const limitOf = (log: ReadonlyArray<ProjectEvent>): Option.Option<number> =>
  Option.map(sessionOf(log), correctionLimit)

/**
 * A second session, `s-2`, through two corrections and a review that
 * asks for changes; attempts carry no session id, and the handoffs, which
 * name `s-1`, do not count in it.
 */
const secondSession: ReadonlyArray<ProjectEvent> = [
  opened(otherSession),
  intended(1),
  finished(1, new Success()),
  intended(2, Roles.Reviewer),
  finished(2, new ChangesRequested()),
  intended(3, Roles.Corrector),
  finished(3, new Success()),
  intended(4, Roles.Reviewer),
  finished(4, new ChangesRequested()),
  intended(5, Roles.Corrector),
  finished(5, new Success()),
  intended(6, Roles.Reviewer),
  finished(6, new ChangesRequested()),
]

describe("correctionLimit", () => {
  it("is maxCorrections with no grant, and adds every grant of the session", () => {
    expect(limitOf([opened()])).toEqual(Option.some(maxCorrections))
    expect(limitOf([opened(), granted(1), granted(3)])).toEqual(Option.some(maxCorrections + 4))
  })

  it("keeps the session's grants in order with their notes", () => {
    expect(Option.map(sessionOf([opened(), granted(1), granted(3)]), (session) => session.roundsGranted)).toEqual(
      Option.some([
        { count: 1, note: "1 more." },
        { count: 3, note: "3 more." },
      ]),
    )
  })
})

describe("the limit raised by grants", () => {
  it("two grants of 1 allow a third and a fourth correction, and refuse a fifth", () => {
    const { third, fourth, fifth } = throughFourCorrections([granted(1), granted(1)])
    expect(decide(new Correct(), third)).toEqual(ok)
    expect(decide(new Correct(), fourth)).toEqual(ok)
    expect(refusals(new Correct(), fifth)).toEqual([new CorrectionsExhausted({ corrections: 4, limit: 4 })])
  })

  it("a single grant of 2 does the same", () => {
    const { third, fourth, fifth } = throughFourCorrections([granted(2)])
    expect(decide(new Correct(), third)).toEqual(ok)
    expect(decide(new Correct(), fourth)).toEqual(ok)
    expect(refusals(new Correct(), fifth)).toEqual([new CorrectionsExhausted({ corrections: 4, limit: 4 })])
  })

  it("a grant given between corrections counts as well", () => {
    const fourth = [...twiceCorrected, granted(1), ...roundAfter(6)]
    expect(refusals(new Correct(), fourth)).toEqual([new CorrectionsExhausted({ corrections: 3, limit: 3 })])
    expect(decide(new Correct(), [...fourth, granted(1)])).toEqual(ok)
  })

  it("a grant in one session does not count in the next", () => {
    const earlier = [...twiceCorrected, granted(2), closed(CloseKinds.Unconverged)]
    const next = [...earlier, ...secondSession]
    expect(limitOf(next)).toEqual(Option.some(maxCorrections))
    expect(refusals(new Correct(), next)).toContainEqual(new CorrectionsExhausted({ corrections: 2, limit: 2 }))
    const grantedNext = [...next, granted(2, otherSession)]
    expect(limitOf(grantedNext)).toEqual(Option.some(maxCorrections + 2))
    expect(Arr.filter(refusals(new Correct(), grantedNext), Schema.is(CorrectionsExhausted))).toEqual([])
  })

  it("a grant naming another session while one is open leaves the limit unchanged", () => {
    const elsewhere = [...twiceCorrected, granted(2, otherSession)]
    expect(limitOf(elsewhere)).toEqual(Option.some(maxCorrections))
    expect(Option.map(sessionOf(elsewhere), (session) => session.roundsGranted)).toEqual(Option.some([]))
    expect(refusals(new Correct(), elsewhere)).toEqual([new CorrectionsExhausted({ corrections: 2, limit: 2 })])
  })
})

describe("rounds grant", () => {
  it("is allowed in every open state with no incomplete attempt, and in no other", () => {
    expect(allowedIn(grant(1))).toEqual([
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
    expect(decide(grant(1), [opened()])).toEqual(ok)
    expect(decide(grant(1), implemented)).toEqual(ok)
    expect(decide(grant(1), twiceCorrected)).toEqual(ok)
    expect(decide(grant(1), wasRejected)).toEqual(ok)
  })

  it("is refused with no session, with an incomplete attempt and when Interrupted", () => {
    expect(refusals(grant(1), [])).toEqual([wrongState([])])
    expect(refusals(grant(1), wasClosed)).toEqual([wrongState(wasClosed)])
    expect(refusals(grant(1), implementing)).toEqual([wrongState(implementing)])
    expect(refusals(grant(1), interrupted)).toEqual([wrongState(interrupted)])
  })

  it("needs the lock and nothing the launches need", () => {
    expect(refusals(grant(1), implemented, { ...good, lockHeld: false })).toEqual([lockNotHeld])
    expect(decide(grant(1), implemented, broken)).toEqual(ok)
  })

  it("is not refused by a moved HEAD", () => {
    expect(decide(grant(1), implemented, withMovedHead(good))).toEqual(ok)
  })
})

describe("rounds grant at the safe-integer bound", () => {
  /** The largest count a session with no grant may be granted: its limit is then exactly the largest safe integer. */
  const largest = Number.MAX_SAFE_INTEGER - maxCorrections
  const earlierCount = 5

  it("allows the largest grant that keeps the limit a safe integer, and refuses one more", () => {
    expect(decide(grant(largest), [opened()])).toEqual(ok)
    expect(refusals(grant(largest + 1), [opened()])).toEqual([
      new RoundsLimitUnsafe({ granted: 0, count: largest + 1 }),
    ])
  })

  it("counts the session's earlier grants", () => {
    const afterEarlier = [opened(), granted(earlierCount)]
    expect(decide(grant(largest - earlierCount), afterEarlier)).toEqual(ok)
    expect(refusals(grant(largest - earlierCount + 1), afterEarlier)).toEqual([
      new RoundsLimitUnsafe({ granted: earlierCount, count: largest - earlierCount + 1 }),
    ])
  })

  it("leaves an exact limit after the largest grant, and refuses any grant past it", () => {
    const atBound = [opened(), granted(largest)]
    expect(limitOf(atBound)).toEqual(Option.some(Number.MAX_SAFE_INTEGER))
    expect(refusals(grant(1), atBound)).toEqual([new RoundsLimitUnsafe({ granted: largest, count: 1 })])
  })

  it("does not count a grant of an earlier session", () => {
    const next = [...twiceCorrected, granted(largest), closed(CloseKinds.Unconverged), ...secondSession]
    expect(decide(grant(largest), next)).toEqual(ok)
  })
})

describe("a replayed log whose grants pass the safe-integer bound", () => {
  /** A hand-edited log: `SessionOpened`, then a schema-valid grant the rule would refuse. */
  const replayed = [opened(), granted(Number.MAX_SAFE_INTEGER)]
  /** Two such grants, whose sum is no longer exact. */
  const replayedTwice = [...replayed, granted(Number.MAX_SAFE_INTEGER)]

  it("folds to a limit of exactly Number.MAX_SAFE_INTEGER", () => {
    expect(limitOf(replayed)).toEqual(Option.some(Number.MAX_SAFE_INTEGER))
    expect(limitOf(replayedTwice)).toEqual(Option.some(Number.MAX_SAFE_INTEGER))
  })

  it("returns refusals for close --unconverged without throwing", () => {
    expect(refusals(unconverged, replayed)).toEqual([
      wrongState(replayed),
      new CorrectionsRemain({ corrections: 0, limit: Number.MAX_SAFE_INTEGER }),
    ])
  })

  it("returns refusals for correct without throwing", () => {
    expect(refusals(new Correct(), replayed)).toContainEqual(wrongState(replayed))
    expect(refusals(new Correct(), replayedTwice)).toContainEqual(wrongState(replayedTwice))
  })

  it("refuses any further grant with saturated fields", () => {
    expect(refusals(grant(1), replayedTwice)).toEqual([
      new RoundsLimitUnsafe({ granted: Number.MAX_SAFE_INTEGER, count: 1 }),
    ])
  })
})

/** Review op-6, at the limit, with findings F1 and F2 recorded. */
const atLimitFindings = [...twiceCorrected, recorded(6, ["F1", "F2"])]
const atLimitOneOverruled = [...atLimitFindings, ...overruled(6, "F1", 1)]
const atLimitBothOverruled = [...atLimitOneOverruled, ...overruled(6, "F2", 2)]
/** The twice-corrected session whose last review succeeded instead. */
const atLimitClean = Arr.append(Arr.dropRight(twiceCorrected, 1), finished(6, new Success()))
/** One correction, then a review that asks for changes: one below the limit. */
const oneBelow = [
  ...corrected,
  approved(3, Roles.Reviewer),
  intended(4, Roles.Reviewer),
  finished(4, new ChangesRequested()),
]

describe("session close --unconverged", () => {
  it("is allowed at the limit with an unoverruled finding of a review that asked for changes", () => {
    expect(decide(unconverged, atLimitFindings)).toEqual(ok)
    expect(decide(unconverged, atLimitOneOverruled)).toEqual(ok)
  })

  it("is allowed at the limit for a review with no FindingsRecorded", () => {
    expect(decide(unconverged, twiceCorrected)).toEqual(ok)
  })

  it("is allowed at a limit raised by a grant once the granted corrections are used", () => {
    const { fourth } = throughFourCorrections([granted(1)])
    expect(decide(unconverged, fourth)).toEqual(ok)
  })

  it("is refused with CorrectionsRemain one correction below the limit", () => {
    expect(refusals(unconverged, oneBelow)).toEqual([new CorrectionsRemain({ corrections: 1, limit: 2 })])
  })

  it("is refused with CorrectionsRemain after a grant lifts the limit", () => {
    expect(refusals(unconverged, [...twiceCorrected, granted(1)])).toEqual([
      new CorrectionsRemain({ corrections: 2, limit: 3 }),
    ])
  })

  it("is refused with WrongState when every finding is overruled, where --finished applies", () => {
    expect(refusals(unconverged, atLimitBothOverruled)).toEqual([wrongState(atLimitBothOverruled)])
  })

  it("is refused with WrongState after a Success review", () => {
    expect(refusals(unconverged, atLimitClean)).toEqual([wrongState(atLimitClean)])
  })

  it("is refused with WrongState while an implement awaits its handoff, its corrections short as well", () => {
    expect(refusals(unconverged, implemented)).toEqual([
      wrongState(implemented),
      new CorrectionsRemain({ corrections: 0, limit: 2 }),
    ])
  })

  it("is refused with WrongState in Rejected", () => {
    const rejectedAtLimit = [...twiceCorrected, rejected(6)]
    expect(refusals(unconverged, rejectedAtLimit)).toEqual([wrongState(rejectedAtLimit)])
  })

  it("needs the lock, and no attestation, worktree check, pin, report or snapshot", () => {
    expect(refusals(unconverged, twiceCorrected, { ...good, lockHeld: false })).toEqual([lockNotHeld])
    expect(decide(unconverged, twiceCorrected, broken)).toEqual(ok)
  })

  it("is not refused by a moved HEAD", () => {
    expect(decide(unconverged, twiceCorrected, withMovedHead(good))).toEqual(ok)
  })

  it("leaves the session ended unconverged, and session open allowed after it", () => {
    const ended = [...twiceCorrected, closed(CloseKinds.Unconverged)]
    expect(foldSession(ended).state).toMatchObject({ _tag: "SessionEnded", how: CloseKinds.Unconverged })
    expect(decide(new SessionOpen(), ended)).toEqual(ok)
  })
})

describe("at the limit, exactly one of --finished and --unconverged", () => {
  const closeFinished = new SessionClose({ how: CloseKinds.Finished })
  const cases: ReadonlyArray<readonly [string, ReadonlyArray<ProjectEvent>]> = [
    ["no FindingsRecorded", twiceCorrected],
    ["two findings, none overruled", atLimitFindings],
    ["two findings, one overruled", atLimitOneOverruled],
    ["two findings, both overruled", atLimitBothOverruled],
  ]

  it.each(cases)("applies with %s", (_name, log) => {
    const state = foldSession(log).state
    expect(awaitsClose(state) !== awaitsUnconverged(state)).toBe(true)
    const allowedKinds = Arr.filter([closeFinished, unconverged], (close) => Arr.isReadonlyArrayEmpty(refusals(close, log)))
    expect(Arr.length(allowedKinds)).toBe(1)
  })
})
