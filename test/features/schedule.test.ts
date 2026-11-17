// The scheduler (plan Task B9; design "Scheduler", C19, H1, C6).
import { describe, expect, it } from "@effect/vitest"
import { Option, Result, Schema } from "effect"
import { type Client, Clients } from "../../src/domain/clients.ts"
import { Revision, TrancheId } from "../../src/domain/ids.ts"
import { ChangesRequested, Success } from "../../src/domain/outcomes.ts"
import { defaultRoleClients, Roles } from "../../src/domain/roles.ts"
import { Windows } from "../../src/domain/window.ts"
import {
  Admits,
  type Candidate,
  CandidateKinds,
  EndNotConverged,
  HoldQuota,
  Launch,
  RefusedByAllocation,
  RefusedByPacing,
  type ScheduleContext,
  type ProjectView,
  schedule,
  Wait,
} from "../../src/features/schedule.ts"

const t1 = TrancheId.make("t-1")
const t2 = TrancheId.make("t-2")
const entry = { tranche: t1, trancheBase: Revision.make("0".repeat(40)), revision: Revision.make("a".repeat(40)) }
const view = (patch: Partial<ProjectView> = {}): ProjectView => ({
  blockedForAll: false,
  queue: [entry],
  headLastReview: Option.none(),
  correctionRounds: 0,
  maxCorrectionRounds: 2,
  roles: defaultRoleClients,
  nextTranche: Option.some(t2),
  nextApproved: true,
  implementAllowed: true,
  ...patch,
})
const allowAll = () => new Admits()
const context = (patch: Partial<ScheduleContext> = {}): ScheduleContext => ({
  resetTimeOf: (provider: Client) => (provider === Clients.Claude ? Option.some(100) : Option.some(200)),
  quotaHeld: () => false,
  verdict: allowAll,
  ...patch,
})
const kindOf = (result: ReturnType<typeof schedule>) =>
  Schema.is(Launch)(result) ? result.candidate.kind : result

describe("schedule: candidates and order", () => {
  it("orders by provider reset time: Claude's implement step before Codex's review", () => {
    expect(kindOf(schedule(view(), context()))).toBe(CandidateKinds.Implement)
  })

  it("puts a provider with no known reset time last", () => {
    const ctx = context({ resetTimeOf: (p) => (p === Clients.Claude ? Option.none() : Option.some(200)) })
    expect(kindOf(schedule(view(), ctx))).toBe(CandidateKinds.Review)
  })

  it("breaks a tie toward the review", () => {
    const ctx = context({ resetTimeOf: () => Option.some(100) })
    expect(kindOf(schedule(view(), ctx))).toBe(CandidateKinds.Review)
  })

  it("makes the correction the only candidate when the last review requested changes and rounds remain", () => {
    const v = view({ headLastReview: Option.some(new ChangesRequested()), correctionRounds: 1 })
    expect(kindOf(schedule(v, context()))).toBe(CandidateKinds.Correction)
  })

  it("ends not converged when the rounds are used up (maxCorrectionRounds 2)", () => {
    const v = view({ headLastReview: Option.some(new ChangesRequested()), correctionRounds: 2 })
    expect(schedule(v, context())).toEqual(new EndNotConverged({ tranche: t1 }))
  })

  it("offers no implement step when the next tranche is not approved or the bound is full", () => {
    const ctx = context({ resetTimeOf: () => Option.some(100) })
    const only = (v: ProjectView) => kindOf(schedule(v, context({ ...ctx, verdict: (c: Candidate) => (c.kind === CandidateKinds.Review ? new RefusedByAllocation() : new Admits()) })))
    expect(only(view({ nextApproved: false }))).toEqual(new Wait())
    expect(only(view({ implementAllowed: false }))).toEqual(new Wait())
  })

  it("reviews after a passing review only when the queue still has a head", () => {
    expect(kindOf(schedule(view({ headLastReview: Option.some(new Success()), nextTranche: Option.none() }), context()))).toBe(CandidateKinds.Review)
  })
})

describe("schedule: holds and refusals", () => {
  it("waits while a hold blocks every launch", () => {
    expect(schedule(view({ blockedForAll: true }), context())).toEqual(new Wait())
  })

  it("skips a candidate whose provider is under a quota hold", () => {
    const ctx = context({ quotaHeld: (p) => p === Clients.Claude })
    expect(kindOf(schedule(view(), ctx))).toBe(CandidateKinds.Review)
  })

  it("creates at most one quota hold, for the first candidate refused by rule 1", () => {
    const ctx = context({
      verdict: (c) =>
        new RefusedByPacing({ windows: c.provider === Clients.Claude ? [Windows.FiveHour] : [Windows.Weekly] }),
    })
    expect(schedule(view(), ctx)).toEqual(new HoldQuota({ provider: Clients.Claude, windows: [Windows.FiveHour] }))
  })

  it("holds for the first rule-1 refusal even after an earlier rule-2 refusal", () => {
    const ctx = context({
      verdict: (c) =>
        c.kind === CandidateKinds.Implement
          ? new RefusedByAllocation()
          : new RefusedByPacing({ windows: [Windows.Weekly] }),
    })
    expect(schedule(view(), ctx)).toEqual(new HoldQuota({ provider: Clients.Codex, windows: [Windows.Weekly] }))
  })

  it("creates no hold for rule-2 refusals; it waits", () => {
    expect(schedule(view(), context({ verdict: () => new RefusedByAllocation() }))).toEqual(new Wait())
  })

  it("launches the next candidate when the first is refused", () => {
    const ctx = context({ verdict: (c) => (c.kind === CandidateKinds.Implement ? new RefusedByAllocation() : new Admits()) })
    expect(kindOf(schedule(view(), ctx))).toBe(CandidateKinds.Review)
  })
})

describe("Launch", () => {
  it("accepts only roles of the closed vocabulary", () => {
    const decode = Schema.decodeUnknownResult(Launch)
    const launch = (role: string) => ({
      _tag: "Launch",
      candidate: { kind: CandidateKinds.Review, tranche: "t-1", role, provider: Clients.Codex },
    })
    expect(Result.isSuccess(decode(launch(Roles.Reviewer)))).toBe(true)
    expect(Result.isFailure(decode(launch("boss")))).toBe(true)
  })
})
