// `rounds grant` and `session close --unconverged` through the Program
// (v0.2.0 design, "The correction limit"; dogfood-7), over the handoff
// harness with a real worktree: the unconverged close is refused while a
// correction remains, a grant lifts the limit by its count, `status`
// shows the grants and the limit, and the close at the limit records
// `unconverged` in the log, after which a new session opens.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Option, Schema } from "effect"
import { RoundsGranted, SessionClosed } from "../../src/domain/events.ts"
import { CloseKinds } from "../../src/domain/session.ts"
import { SessionEnded } from "../../src/domain/session-state.ts"
import { openSessionOf } from "../../src/features/session-phases.ts"
import { foldSession } from "../../src/features/session.ts"
import { grantRounds } from "../../src/program/rounds.ts"
import { closeSession } from "../../src/program/session.ts"
import { status } from "../../src/program/status.ts"
import { attestedCorrect } from "./handoff-commands.ts"
import {
  afterFindings,
  corrected as correctedWith,
  correctorEdit,
  eventsWhere,
  reviewed,
  sessionIdOf,
} from "./handoff-steps.ts"
import { eventsOf, type Harness, repositoryHarnessMillis, withHarness } from "./session-harness.ts"
import { open, refusedFor } from "./session-steps.ts"

/**
 * `correct --findings <owner file> --waive --attest`. A later correction
 * of this cycle meets a Claude quota hold (`QuotaHeld` without
 * `--waive`), so the owner waives it, as `reviewed` does for every review.
 */
const corrected = (harness: Harness) => correctedWith(harness, correctorEdit, { waive: true })

/** `session close --unconverged`. */
const unconverged = (harness: Harness) => closeSession(harness.context, { how: CloseKinds.Unconverged, note: "slow" })

/** The open session's grants and correction limit, as `status` shows them. */
const shownLimit = (harness: Harness) =>
  Effect.map(status(harness.status), (report) => ({
    roundsGranted: Option.map(openSessionOf(report.state), (session) => session.roundsGranted),
    correctionLimit: report.correctionLimit,
  }))

const grantedThenClosed = (harness: Harness) =>
  Effect.gen(function* () {
    expect((yield* status(harness.status)).correctionLimit).toEqual(Option.none())
    yield* afterFindings(harness)
    yield* refusedFor(harness, unconverged(harness), ["CorrectionsRemain"])
    yield* corrected(harness)
    yield* reviewed(harness)
    yield* refusedFor(harness, unconverged(harness), ["CorrectionsRemain"])
    yield* corrected(harness)
    yield* reviewed(harness)
    const sessionId = yield* sessionIdOf(harness)
    const granted = yield* grantRounds(harness.context, { count: 1, note: "One more round." })
    expect(granted).toEqual(new RoundsGranted({ sessionId, count: 1, note: "One more round." }))
    expect(Arr.last(yield* eventsOf(harness))).toEqual(Option.some(granted))
    expect(yield* shownLimit(harness)).toEqual({
      roundsGranted: Option.some([{ count: 1, note: "One more round." }]),
      correctionLimit: Option.some(3),
    })
    yield* refusedFor(harness, unconverged(harness), ["CorrectionsRemain"])
    yield* corrected(harness)
    yield* reviewed(harness)
    yield* refusedFor(harness, attestedCorrect(harness), ["CorrectionsExhausted"])
    const closed = yield* unconverged(harness)
    expect(closed).toEqual(new SessionClosed({ sessionId, how: CloseKinds.Unconverged, note: "slow", attests: Option.none() }))
    expect(Arr.last(yield* eventsWhere(harness, Schema.is(SessionClosed)))).toEqual(Option.some(closed))
    expect(foldSession(yield* eventsOf(harness)).state).toEqual(
      new SessionEnded({ sessionId, how: CloseKinds.Unconverged }),
    )
    yield* open(harness)
    expect((yield* status(harness.status)).correctionLimit).toEqual(Option.some(2))
  })

describe("rounds grant and close --unconverged through the Program", () => {
  it.effect("refuse the close below the limit, lift the limit by a grant, and close unconverged at it", () =>
    withHarness({ repository: true }, grantedThenClosed), repositoryHarnessMillis,
  )
})
