// The assisted session's log events (plan "Events"): the optional leader
// start time on Launched, and the shapes the session events refuse.
import { describe, expect, it } from "@effect/vitest"
import { Option, Result, Schema } from "effect"
import { Launched, ProjectEvent } from "../../src/domain/events.ts"
import { OpId } from "../../src/domain/ids.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Attestations, CloseKinds } from "../../src/domain/session.ts"

const decode = Schema.decodeUnknownResult(ProjectEvent)
const encode = Schema.encodeUnknownResult(ProjectEvent)
const tree = "b".repeat(40)

describe("Launched", () => {
  it("records the leader's start time when one was read", () => {
    const row = { _tag: "Launched", opId: "op-1", pgid: 7, leaderStartedAt: "Thu Nov 19 20:00:00 2026" }
    expect(Result.flatMap(decode(row), encode)).toEqual(Result.succeed(row))
  })

  it("leaves the start time out when none was read", () => {
    const launched = new Launched({ opId: OpId.make("op-1"), pgid: 7, leaderStartedAt: Option.none() })
    expect(encode(launched)).toEqual(Result.succeed({ _tag: "Launched", opId: "op-1", pgid: 7 }))
  })
})

describe("session events", () => {
  it("refuses a task hash that is not 64 lowercase hex digits", () => {
    const row = {
      _tag: "SessionOpened",
      sessionId: "s-1",
      tranche: "t-1",
      taskPath: "/task.md",
      taskSha256: "ABC",
      baseRevision: "a".repeat(40),
      worktree: { path: "/w", gitDir: "/g", commonDir: "/c" },
    }
    expect(Result.isFailure(decode(row))).toBe(true)
  })

  it("refuses a close kind outside the vocabulary", () => {
    const row = { _tag: "SessionClosed", sessionId: "s-1", how: "paused", note: "" }
    expect(Result.isFailure(decode(row))).toBe(true)
  })

  it("accepts every close kind, with the attestation optional", () => {
    const rows = Object.values(CloseKinds).map((how) => ({ _tag: "SessionClosed", sessionId: "s-1", how, note: "" }))
    rows.forEach((row) => {
      expect(Result.flatMap(decode(row), encode)).toEqual(Result.succeed(row))
    })
  })

  it("refuses an attestation outside the vocabulary", () => {
    const row = {
      _tag: "HandoffApproved",
      sessionId: "s-1",
      fromOpId: "op-1",
      toRole: Roles.Reviewer,
      tree,
      attests: "quiescence",
    }
    expect(Result.isFailure(decode(row))).toBe(true)
    expect(Result.isSuccess(decode({ ...row, attests: Attestations.QuiescenceAndInspection }))).toBe(true)
  })
})
