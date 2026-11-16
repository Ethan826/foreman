import { describe, expect, it } from "@effect/vitest"
import { Record, Result, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import {
  Approval,
  Drift,
  Failure,
  Hold,
  HoldKinds,
  Protected,
  Quota,
  Uncertain,
  WorktreeKinds,
} from "../../src/domain/holds.ts"

const revision = "a".repeat(40)

const encoded = [
  { _tag: "Approval", tranche: "t-1", revision },
  {
    _tag: "Quota",
    provider: Clients.Claude,
    windows: ["fiveHour"],
    heldMono: { bootId: "B-1", micros: 10 },
    ledgerSeq: 4,
  },
  { _tag: "Quota", provider: Clients.Codex, windows: [], ledgerSeq: 1 },
  { _tag: "Uncertain", opId: "op-1" },
  { _tag: "Failure", opId: "op-1", outcome: { _tag: "MaxTurns" } },
  {
    _tag: "Drift",
    worktree: "review",
    expected: revision,
    head: "b".repeat(40),
    dirty: false,
  },
  { _tag: "Protected", paths: [".git/config"] },
] as const

describe("Hold", () => {
  const decode = Schema.decodeUnknownResult(Hold)
  const encode = Schema.encodeUnknownResult(Hold)

  it.each(encoded)("round-trips %j", (input) => {
    const decoded = decode(input)
    expect(Result.isSuccess(decoded)).toBe(true)
    expect(Result.flatMap(decoded, encode)).toEqual(Result.succeed(input))
  })

  it("rejects an unknown worktree kind and an empty path list", () => {
    expect(
      Result.isFailure(
        decode({ ...encoded[5], worktree: "owner" }),
      ),
    ).toBe(true)
    expect(Result.isFailure(decode({ _tag: "Protected", paths: [] }))).toBe(true)
  })

  it("names one kind per hold class, equal to the tags", () => {
    const tags = [
      Approval,
      Quota,
      Uncertain,
      Failure,
      Drift,
      Protected,
    ].map((c) => c.identifier)
    expect([...Record.values(HoldKinds)].sort()).toEqual([...tags].sort())
  })

  it("names the two worktrees", () => {
    expect(Record.values(WorktreeKinds).sort()).toEqual(["review", "supervisor"])
  })
})
