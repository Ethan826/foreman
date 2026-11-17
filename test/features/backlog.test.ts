// The pre-approved backlog (plan Task B10; design "Pre-approved
// backlog", C2): stop-before entries never start a tranche alone; at most
// backlogMax entries; a discarded or unwound implement step re-arms its
// approval; a passing review creates the approval hold exactly when the
// next tranche is neither pre-approved nor started. No `backlog remove`.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Option } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import {
  Approved,
  Intended,
  PreApproved,
  type ProjectEvent,
  Reconciled,
  TrancheEnded,
  Unwound,
} from "../../src/domain/events.ts"
import { GrantId, OpId, Revision, TrancheId } from "../../src/domain/ids.ts"
import { Passed } from "../../src/domain/outcomes.ts"
import { type Role, Roles } from "../../src/domain/roles.ts"
import {
  approvalFor,
  approvalHoldOnPass,
  backlogAddAccepted,
  backlogOf,
} from "../../src/features/backlog.ts"

const t = (n: number) => TrancheId.make(`t-${String(n)}`)
const rev = Revision.make("a".repeat(40))
const pre = (n: number, stopBefore = false, permits: ReadonlyArray<string> = []) =>
  new PreApproved({ tranche: t(n), permits, stopBefore })
const live = (n: number, permits: ReadonlyArray<string> = []) =>
  new Approved({ tranche: t(n), revision: rev, permits, base: Option.none() })
const intend = (n: number, op: string, role: Role = Roles.Implementer) =>
  new Intended({
    opId: OpId.make(op),
    tranche: t(n),
    step: { role, round: 0 },
    baseRevision: rev,
    grantId: GrantId.make(`g-${op}`),
    client: Clients.Claude,
    waiverId: Option.none(),
  })
const permitsFor = (n: number, events: ReadonlyArray<ProjectEvent>) =>
  Option.map(approvalFor(t(n), events), (a) => a.permits)

describe("approvalFor", () => {
  it("never starts a stop-before entry by itself", () => {
    expect(approvalFor(t(2), [pre(2, true)])).toEqual(Option.none())
  })

  it("starts a plain pre-approved tranche and a live-approved one", () => {
    expect(permitsFor(2, [pre(2)])).toEqual(Option.some([]))
    expect(permitsFor(2, [pre(2, true), live(2, [".github/"])])).toEqual(Option.some([".github/"]))
  })

  it("prefers the live approval's permits when both cover the tranche", () => {
    expect(permitsFor(2, [pre(2, false, ["a/"]), live(2, ["b/"])])).toEqual(Option.some(["b/"]))
  })

  it("is used by the tranche's implement step and only by it", () => {
    expect(approvalFor(t(2), [pre(2), intend(2, "op-1")])).toEqual(Option.none())
    expect(permitsFor(2, [pre(2), intend(2, "op-1", Roles.Reviewer)])).toEqual(Option.some([]))
  })

  it("is armed again after Reconciled(discard) of that implement step or an unwind", () => {
    const discard = new Reconciled({ opId: OpId.make("op-1"), resolution: "discard" })
    const unwound = new Unwound({ tranches: [t(2)], atHead: rev, target: rev })
    expect(permitsFor(2, [pre(2), intend(2, "op-1"), discard])).toEqual(Option.some([]))
    expect(permitsFor(2, [live(2), intend(2, "op-1"), unwound])).toEqual(Option.some([]))
    const accept = new Reconciled({ opId: OpId.make("op-1"), resolution: "accept" })
    expect(approvalFor(t(2), [pre(2), intend(2, "op-1"), accept])).toEqual(Option.none())
  })

  it("re-arms a stop-before entry as a plain entry after an unwind", () => {
    const unwound = new Unwound({ tranches: [t(2)], atHead: rev, target: rev })
    expect(permitsFor(2, [pre(2, true), live(2), intend(2, "op-1"), unwound])).toEqual(Option.some([]))
  })
})

describe("backlogAddAccepted", () => {
  it("holds at most backlogMax entries, one per tranche, stop-before included", () => {
    const three = [pre(2), pre(3, true), pre(4)]
    expect(backlogAddAccepted(three, t(5), 3)).toBe(false)
    expect(backlogAddAccepted([pre(2)], t(2), 3)).toBe(false)
    expect(backlogAddAccepted([pre(2), pre(3)], t(4), 3)).toBe(true)
    expect(Arr.length(backlogOf([...three, intend(2, "op-1")]))).toBe(2)
  })
})

describe("approvalHoldOnPass", () => {
  const passed = new TrancheEnded({ tranche: t(1), end: new Passed() })
  it("creates the approval hold when the next tranche is neither pre-approved nor started", () => {
    expect(approvalHoldOnPass([intend(1, "op-1"), passed], t(1))).toBe(true)
    expect(approvalHoldOnPass([pre(2, true), intend(1, "op-1"), passed], t(1))).toBe(true)
  })

  it("creates none when the next tranche is pre-approved or already started", () => {
    expect(approvalHoldOnPass([pre(2), intend(1, "op-1"), passed], t(1))).toBe(false)
    expect(approvalHoldOnPass([live(2), intend(1, "op-1"), intend(2, "op-2"), passed], t(1))).toBe(false)
  })
})
