// The review queue (plan Task B8; design "Review queue", C17): a fold of
// the project log; bound 1 by default, 2 allowed per project.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr } from "effect"
import { type ProjectEvent, ReviewQueued, TrancheEnded, Unwound } from "../../src/domain/events.ts"
import { Revision, TrancheId } from "../../src/domain/ids.ts"
import { ChangesRequested, Passed, Success } from "../../src/domain/outcomes.ts"
import { implementAllowed, queueOf, unwindTargets } from "../../src/features/review-queue.ts"

const r = (c: string) => Revision.make(c.repeat(40))
const queued = (t: string, rev: string) =>
  new ReviewQueued({ tranche: TrancheId.make(t), trancheBase: r("0"), revision: r(rev) })
const tranchesIn = (events: ReadonlyArray<ProjectEvent>) =>
  Arr.map(queueOf(events), (entry) => [entry.tranche, entry.revision])

describe("queueOf", () => {
  it("queues results oldest first", () => {
    expect(tranchesIn([queued("t-1", "a"), queued("t-2", "b")])).toEqual([
      ["t-1", r("a")],
      ["t-2", r("b")],
    ])
  })

  it("replaces a tranche's entry in place when its correction commits", () => {
    expect(tranchesIn([queued("t-1", "a"), queued("t-2", "b"), queued("t-1", "c")])).toEqual([
      ["t-1", r("c")],
      ["t-2", r("b")],
    ])
  })

  it("drops a tranche when it ends and drops unwound tranches", () => {
    const ended = new TrancheEnded({ tranche: TrancheId.make("t-1"), end: new Passed() })
    const unwound = new Unwound({ tranches: [TrancheId.make("t-2")], atHead: r("b"), target: r("a") })
    expect(tranchesIn([queued("t-1", "a"), queued("t-2", "b"), ended])).toEqual([["t-2", r("b")]])
    expect(tranchesIn([queued("t-1", "a"), queued("t-2", "b"), unwound])).toEqual([["t-1", r("a")]])
  })
})

describe("implementAllowed", () => {
  it("with bound 1 launches an implement step only on an empty queue", () => {
    expect(implementAllowed(queueOf([]), 1)).toBe(true)
    expect(implementAllowed(queueOf([queued("t-1", "a")]), 1)).toBe(false)
  })

  it("with bound 2 allows one result waiting, not two", () => {
    expect(implementAllowed(queueOf([queued("t-1", "a")]), 2)).toBe(true)
    expect(implementAllowed(queueOf([queued("t-1", "a"), queued("t-2", "b")]), 2)).toBe(false)
  })
})

describe("unwindTargets", () => {
  const two = queueOf([queued("t-1", "a"), queued("t-2", "b")])
  it("on a change request at the head, unwinds exactly the tranches above it", () => {
    expect(unwindTargets(two, new ChangesRequested())).toEqual([TrancheId.make("t-2")])
  })
  it("unwinds nothing on any other outcome, or with nothing above the head", () => {
    expect(unwindTargets(two, new Success())).toEqual([])
    expect(unwindTargets(queueOf([queued("t-1", "a")]), new ChangesRequested())).toEqual([])
  })
})
