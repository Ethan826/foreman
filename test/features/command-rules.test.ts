// The prerequisite matrix of the assisted session's commands (plan
// "Commands and their prerequisites", AC1, and its close rules): each
// command checks only its own prerequisites, so the owner's exits stay
// reachable when the worktree, a client or a file is broken.
import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { Correct, Implement, Reject, Review, SessionOpen, Status } from "../../src/domain/session.ts"
import {
  CorrectionsExhausted,
  HeldBy,
  PinMismatch,
  ReportsNotIntact,
  TreeChanged,
} from "../../src/features/command-rules.ts"
import { opened, treeA, treeB } from "./session-fixtures.ts"
import {
  quota,
  approval,
  failure,
  good,
  broken,
  codex,
  implemented,
  changesAsked,
  twiceCorrected,
  states,
  decide,
  ok,
  viaWaiver,
  refusals,
  wrongState,
  lockNotHeld,
  worktreeFailed,
  notAttested,
  snapshotRefused,
  allowedIn,
} from "./command-fixtures.ts"

describe("status", () => {
  it("is allowed in every state, with every check failing and no lock", () => {
    Object.values(states).forEach((log) => {
      expect(decide(new Status(), log, { ...broken, lockHeld: false })).toEqual(ok)
    })
  })
})

describe("session open", () => {
  it("is allowed only when no session is open", () => {
    expect(allowedIn(new SessionOpen())).toEqual(["none", "closed"])
    expect(refusals(new SessionOpen(), [opened()])).toEqual([wrongState([opened()])])
  })

  it("needs the lock and a passing worktree check", () => {
    expect(refusals(new SessionOpen(), [], { ...good, lockHeld: false })).toEqual([lockNotHeld])
    expect(refusals(new SessionOpen(), [], { ...good, worktreeCheckPassed: false })).toEqual([worktreeFailed])
  })

  it("is refused by a non-quota hold and not by any quota hold", () => {
    expect(refusals(new SessionOpen(), [], { ...good, holds: [approval, failure] })).toEqual([
      new HeldBy({ hold: approval }),
      new HeldBy({ hold: failure }),
    ])
    const quotas = { ...good, holds: [quota(Clients.Claude), quota(Clients.Codex)] }
    expect(decide(new SessionOpen(), [], quotas)).toEqual(ok)
  })

  it("does not need a pin, reports, an attestation or a snapshot", () => {
    const others = { ...good, pinMatches: false, reportsIntact: false, attested: false, snapshot: Option.none() }
    expect(decide(new SessionOpen(), [], others)).toEqual(ok)
  })
})

describe("implement", () => {
  it("is allowed only in an open session with no attempt", () => {
    expect(allowedIn(new Implement())).toEqual(["open, no attempt"])
  })

  it("needs the lock, the worktree check and Claude's pin", () => {
    expect(refusals(new Implement(), [opened()], { ...good, lockHeld: false })).toEqual([lockNotHeld])
    expect(refusals(new Implement(), [opened()], { ...good, worktreeCheckPassed: false })).toEqual([worktreeFailed])
    expect(refusals(new Implement(), [opened()], { ...good, pinMatches: false })).toEqual([
      new PinMismatch({ provider: Clients.Claude }),
    ])
  })

  it("sends a quota hold of its own provider to the waiver step", () => {
    expect(decide(new Implement(), [opened()], { ...good, holds: [quota(Clients.Claude)] })).toEqual(viaWaiver)
  })

  it("is not blocked by the other provider's quota hold", () => {
    expect(decide(new Implement(), [opened()], { ...good, holds: [quota(Clients.Codex)] })).toEqual(ok)
  })

  it("is refused by a non-quota hold, even beside a quota hold", () => {
    const held = { ...good, holds: [quota(Clients.Claude), approval] }
    expect(refusals(new Implement(), [opened()], held)).toEqual([new HeldBy({ hold: approval })])
  })

  it("does not need reports, an attestation or a snapshot", () => {
    const others = { ...good, reportsIntact: false, attested: false, snapshot: Option.none() }
    expect(decide(new Implement(), [opened()], others)).toEqual(ok)
  })
})

describe("review", () => {
  it("is allowed only after a usable implement or correct", () => {
    expect(allowedIn(new Review(), codex)).toEqual(["usable implement", "usable correct"])
  })

  it("needs every launch check, intact reports, the attestation and a passing snapshot", () => {
    expect(refusals(new Review(), implemented, { ...broken, provider: Clients.Codex, holds: [approval] })).toEqual([
      worktreeFailed,
      new PinMismatch({ provider: Clients.Codex }),
      new HeldBy({ hold: approval }),
      new ReportsNotIntact(),
      notAttested,
      snapshotRefused,
    ])
    expect(refusals(new Review(), implemented, { ...codex, lockHeld: false })).toEqual([lockNotHeld])
  })

  it("refuses a snapshot that failed the raw checks", () => {
    const failed = { ...codex, snapshot: Option.some({ tree: treeB, passedRawChecks: false }) }
    expect(refusals(new Review(), implemented, failed)).toEqual([snapshotRefused])
  })

  it("takes any tree that passed the raw checks", () => {
    const other = { ...codex, snapshot: Option.some({ tree: treeB, passedRawChecks: true }) }
    expect(decide(new Review(), implemented, other)).toEqual(ok)
  })

  it("sends Codex's quota hold to the waiver step and ignores Claude's", () => {
    expect(decide(new Review(), implemented, { ...codex, holds: [quota(Clients.Codex)] })).toEqual(viaWaiver)
    expect(decide(new Review(), implemented, { ...codex, holds: [quota(Clients.Claude)] })).toEqual(ok)
  })
})

describe("correct", () => {
  it("is allowed only after a review that asked for changes", () => {
    expect(allowedIn(new Correct())).toEqual(["review with changes"])
  })

  it("needs every launch check, intact reports, the attestation and a snapshot", () => {
    expect(refusals(new Correct(), changesAsked, { ...broken, holds: [failure] })).toEqual([
      worktreeFailed,
      new PinMismatch({ provider: Clients.Claude }),
      new HeldBy({ hold: failure }),
      new ReportsNotIntact(),
      notAttested,
      snapshotRefused,
    ])
    expect(refusals(new Correct(), changesAsked, { ...good, lockHeld: false })).toEqual([lockNotHeld])
    expect(decide(new Correct(), changesAsked, { ...good, holds: [quota(Clients.Claude)] })).toEqual(viaWaiver)
  })

  it("refuses when the snapshot differs from the reviewed tree", () => {
    const moved = { ...good, snapshot: Option.some({ tree: treeB, passedRawChecks: true }) }
    expect(refusals(new Correct(), changesAsked, moved)).toEqual([
      new TreeChanged({ reviewed: Option.some(treeA), current: treeB }),
    ])
  })

  it("refuses a snapshot equal to the reviewed tree that failed the raw checks", () => {
    const failed = { ...good, snapshot: Option.some({ tree: treeA, passedRawChecks: false }) }
    expect(refusals(new Correct(), changesAsked, failed)).toEqual([snapshotRefused])
  })

  it("refuses a third correction", () => {
    expect(refusals(new Correct(), twiceCorrected)).toEqual([new CorrectionsExhausted({ corrections: 2 })])
  })
})

describe("reject", () => {
  it("is allowed only while a usable attempt awaits its handoff", () => {
    expect(allowedIn(new Reject())).toEqual(["usable implement", "review with changes", "clean review", "usable correct"])
  })

  it("needs the lock and nothing else", () => {
    expect(refusals(new Reject(), implemented, { ...good, lockHeld: false })).toEqual([lockNotHeld])
    expect(decide(new Reject(), implemented, broken)).toEqual(ok)
  })
})
