// The assisted session fold (plan "Commands and their prerequisites",
// "Outcomes and usable attempts"): every state the log can leave a
// session in, the correction count, the reviewed tree and the armed
// waivers.
import { describe, expect, it } from "@effect/vitest"
import { Option, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { Intended, type ProjectEvent } from "../../src/domain/events.ts"
import { WaiverId } from "../../src/domain/ids.ts"
import { ChangesRequested, Crashed, Success, Unclassified } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import { CloseKinds, SessionId } from "../../src/domain/session.ts"
import {
  AttemptIncomplete,
  AwaitingHandoff,
  Interrupted,
  NoSession,
  OpenNoAttempt,
  Rejected,
  SessionEnded,
} from "../../src/domain/session-state.ts"
import { foldSession } from "../../src/features/session.ts"
import { openSessionOf } from "../../src/features/session-phases.ts"
import {
  approved,
  closed,
  endedByOwner,
  finished,
  grantId,
  intended,
  launched,
  opened,
  opId,
  rejected,
  reported,
  sessionId,
  treeA,
  treeB,
  waived,
} from "./session-fixtures.ts"

const stateOf = (log: ReadonlyArray<ProjectEvent>) => foldSession(log).state

/** The open session's facts; the test fails when no session is open. */
const sessionOf = (log: ReadonlyArray<ProjectEvent>) =>
  Option.getOrElse(openSessionOf(stateOf(log)), () => expect.unreachable("no open session"))

const implemented = [opened(), intended(1), launched(1), finished(1, new Success())]
const reviewed = [...implemented, approved(1, Roles.Reviewer), intended(2, Roles.Reviewer)]

describe("foldSession states", () => {
  it("is NoSession for an empty log", () => {
    expect(stateOf([])).toEqual(new NoSession())
  })

  it("has no open session facts when none is open", () => {
    expect(openSessionOf(new NoSession())).toEqual(Option.none())
    expect(openSessionOf(new SessionEnded({ sessionId, how: CloseKinds.Finished }))).toEqual(Option.none())
  })

  it("is OpenNoAttempt right after SessionOpened", () => {
    const state = stateOf([opened()])
    expect(state).toBeInstanceOf(OpenNoAttempt)
    expect(sessionOf([opened()]).opened).toEqual(opened())
  })

  it("is AttemptIncomplete after Intended, before and after Launched", () => {
    const before = stateOf([opened(), intended(1)])
    const after = stateOf([opened(), intended(1), launched(1)])
    expect(before).toBeInstanceOf(AttemptIncomplete)
    expect(after).toBeInstanceOf(AttemptIncomplete)
    if (!Schema.is(AttemptIncomplete)(after)) return
    expect(after.incomplete.map((attempt) => attempt.intent.opId)).toEqual([opId(1)])
    expect(after.incomplete[0]?.launched).toEqual(Option.some(launched(1)))
  })

  it("is Interrupted once the owner attested every incomplete attempt", () => {
    const state = stateOf([opened(), intended(1), launched(1), endedByOwner(1)])
    expect(state).toBeInstanceOf(Interrupted)
    if (!Schema.is(Interrupted)(state)) return
    expect(state.incomplete[0]?.endedByOwner).toEqual(Option.some(endedByOwner(1)))
  })

  it("ignores an attestation naming another grant", () => {
    const state = stateOf([opened(), intended(1), endedByOwner(1, grantId(9))])
    expect(state).toBeInstanceOf(AttemptIncomplete)
  })

  it("ignores an attestation of an unknown attempt", () => {
    expect(stateOf([opened(), intended(1), endedByOwner(2)])).toBeInstanceOf(AttemptIncomplete)
  })

  it("awaits a handoff after a usable implement", () => {
    const state = stateOf(implemented)
    expect(state).toEqual(
      new AwaitingHandoff({
        session: sessionOf(implemented),
        opId: opId(1),
        role: Roles.Implementer,
        outcome: new Success(),
        usable: true,
      }),
    )
  })

  it("marks an implement that crashed as unusable", () => {
    const state = stateOf([opened(), intended(1), finished(1, new Crashed({ signal: "SIGKILL" }))])
    expect(state).toMatchObject({ _tag: "AwaitingHandoff", usable: false })
  })

  it("marks a review asking for changes as usable, in role reviewer", () => {
    const state = stateOf([...reviewed, finished(2, new ChangesRequested())])
    expect(state).toMatchObject({ _tag: "AwaitingHandoff", role: Roles.Reviewer, usable: true, opId: opId(2) })
  })

  it("marks an unclassified review as unusable", () => {
    const state = stateOf([...reviewed, finished(2, new Unclassified())])
    expect(state).toMatchObject({ _tag: "AwaitingHandoff", usable: false })
  })

  it("is Rejected after HandoffRejected", () => {
    expect(stateOf([...implemented, rejected(1)])).toEqual(
      new Rejected({ session: sessionOf(implemented), fromOpId: opId(1) }),
    )
  })

  it("is SessionEnded after SessionClosed", () => {
    expect(stateOf([...implemented, closed(CloseKinds.Abandoned)])).toEqual(
      new SessionEnded({ sessionId, how: CloseKinds.Abandoned }),
    )
  })

  it("keeps an incomplete attempt in charge over an earlier rejection", () => {
    const state = stateOf([...implemented, rejected(1), intended(2, Roles.Reviewer)])
    expect(state).toBeInstanceOf(AttemptIncomplete)
  })
})

describe("foldSession scope", () => {
  it("ignores attempts written while no session is open", () => {
    expect(stateOf([intended(1)])).toEqual(new NoSession())
    const afterClose = [opened(), closed(CloseKinds.Abandoned), intended(2)]
    expect(stateOf(afterClose)).toBeInstanceOf(SessionEnded)
  })

  it("starts a new session with no attempts, reports or corrections", () => {
    const second = SessionId.make("s-2")
    const log = [...implemented, intended(2, Roles.Corrector), closed(CloseKinds.Abandoned), opened(second)]
    expect(stateOf(log)).toBeInstanceOf(OpenNoAttempt)
    expect(sessionOf(log)).toMatchObject({ attempts: [], reports: [], corrections: 0 })
    expect(sessionOf(log).opened.sessionId).toBe(second)
  })

  it("does not complete an attempt with another attempt's Finished", () => {
    const state = stateOf([opened(), intended(1), finished(2, new Success())])
    expect(state).toBeInstanceOf(AttemptIncomplete)
  })
})

describe("foldSession facts", () => {
  it("counts each corrector Intended as one correction", () => {
    const corrected = [
      ...reviewed,
      finished(2, new ChangesRequested()),
      approved(2, Roles.Corrector),
      intended(3, Roles.Corrector),
      finished(3, new Success()),
      approved(3, Roles.Reviewer, treeB),
      intended(4, Roles.Reviewer),
      finished(4, new ChangesRequested()),
      approved(4, Roles.Corrector, treeB),
      intended(5, Roles.Corrector),
    ]
    expect(sessionOf(corrected).corrections).toBe(2)
    expect(sessionOf(reviewed).corrections).toBe(0)
  })

  it("takes the reviewed tree from the latest handoff to a reviewer", () => {
    expect(sessionOf(implemented).reviewedTree).toEqual(Option.none())
    expect(sessionOf(reviewed).reviewedTree).toEqual(Option.some(treeA))
    const again = [...reviewed, finished(2, new ChangesRequested()), approved(2, Roles.Corrector, treeA)]
    const second = [...again, intended(3, Roles.Corrector), finished(3, new Success()), approved(3, Roles.Reviewer, treeB)]
    expect(sessionOf(again).reviewedTree).toEqual(Option.some(treeA))
    expect(sessionOf(second).reviewedTree).toEqual(Option.some(treeB))
  })

  it("keeps each attempt's recorded report", () => {
    expect(sessionOf([...implemented, reported(1)]).reports).toEqual([reported(1)])
  })

  it("lists attempts in log order", () => {
    expect(sessionOf(reviewed).attempts.map((attempt) => attempt.intent)).toEqual([
      intended(1),
      intended(2, Roles.Reviewer),
    ])
  })

  it("reports the armed waiver of each provider", () => {
    const plain = intended(1)
    const used = new Intended({
      opId: plain.opId,
      tranche: plain.tranche,
      step: plain.step,
      baseRevision: plain.baseRevision,
      grantId: plain.grantId,
      client: plain.client,
      waiverId: Option.some(WaiverId.make("w-1")),
    })
    expect(foldSession([waived(Clients.Codex)]).armedWaivers).toEqual({
      [Clients.Claude]: Option.none(),
      [Clients.Codex]: Option.some(WaiverId.make("w-1")),
    })
    expect(foldSession([opened(), waived(Clients.Claude), used]).armedWaivers[Clients.Claude]).toEqual(Option.none())
  })
})
