// Waivers (plan Task B7; design "Waivers", C7): armed from Waived until the
// next launch attempt, bound to its provider, used by an Intended that
// names it, expired by WaiverExpired; accepted only under a quota hold of
// its provider and while no waiver is armed.
import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { type Client, Clients } from "../../src/domain/clients.ts"
import { HoldCreated, Intended, type ProjectEvent, Waived, WaiverExpired } from "../../src/domain/events.ts"
import { Failure, Quota } from "../../src/domain/holds.ts"
import { GrantId, LedgerSeq, OpId, Revision, TrancheId, WaiverId } from "../../src/domain/ids.ts"
import { MaxTurns } from "../../src/domain/outcomes.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Windows } from "../../src/domain/window.ts"
import { armedWaiver, waiveAccepted } from "../../src/features/waiver.ts"

const w1 = WaiverId.make("w-1")
const waived = (provider: Client = Clients.Claude) => new Waived({ provider, waiverId: w1 })
const intendedWith = (waiver: Option.Option<WaiverId>) =>
  new Intended({
    opId: OpId.make("op-1"),
    tranche: TrancheId.make("t-1"),
    step: { role: Roles.Implementer, round: 0 },
    baseRevision: Revision.make("a".repeat(40)),
    grantId: GrantId.make("g-1"),
    client: Clients.Claude,
    waiverId: waiver,
  })
const quota = (provider: Client = Clients.Claude) =>
  new Quota({ provider, windows: [Windows.FiveHour], heldMono: Option.none(), ledgerSeq: LedgerSeq.make(1) })
const armed = (events: ReadonlyArray<ProjectEvent>, provider: Client = Clients.Claude) =>
  armedWaiver(events, provider)

describe("armedWaiver", () => {
  it("is armed from Waived for its provider only", () => {
    expect(armed([waived()])).toEqual(Option.some(w1))
    expect(armed([waived()], Clients.Codex)).toEqual(Option.none())
  })

  it("is used up by an Intended that names it", () => {
    expect(armed([waived(), intendedWith(Option.some(w1))])).toEqual(Option.none())
  })

  it("stays armed across an Intended that does not name it (another provider's step)", () => {
    expect(armed([waived(), intendedWith(Option.none())])).toEqual(Option.some(w1))
  })

  it("expires on any refused attempt", () => {
    expect(armed([waived(), new WaiverExpired({ waiverId: w1 })])).toEqual(Option.none())
  })
})

describe("waiveAccepted", () => {
  it("needs a quota hold of the waived provider", () => {
    expect(waiveAccepted([quota()], [], Clients.Claude)).toBe(true)
    expect(waiveAccepted([quota(Clients.Codex)], [], Clients.Claude)).toBe(false)
    expect(waiveAccepted([new Failure({ opId: OpId.make("op-1"), outcome: new MaxTurns() })], [], Clients.Claude)).toBe(false)
  })

  it("is refused while a waiver is already armed", () => {
    expect(waiveAccepted([quota()], [waived(Clients.Codex)], Clients.Claude)).toBe(false)
  })

  it("is accepted again once the armed waiver is used or expired", () => {
    expect(waiveAccepted([quota()], [waived(), new WaiverExpired({ waiverId: w1 })], Clients.Claude)).toBe(true)
  })

  it("ignores holds already created into the log (a HoldCreated is not a live hold)", () => {
    expect(waiveAccepted([], [new HoldCreated({ hold: quota() })], Clients.Claude)).toBe(false)
  })
})
