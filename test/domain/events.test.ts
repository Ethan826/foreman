import { describe, expect, it } from "@effect/vitest"
import { Result, Schema } from "effect"
import { Clients } from "../../src/domain/clients.ts"
import { ProjectEvent } from "../../src/domain/events.ts"
import { Roles } from "../../src/domain/roles.ts"
import { Windows } from "../../src/domain/window.ts"

const rev = "a".repeat(40)
const head = "b".repeat(40)

const events = [
  {
    _tag: "Intended",
    opId: "op-1",
    tranche: "t-1",
    step: { role: Roles.Implementer, round: 0 },
    baseRevision: rev,
    grantId: "g-1",
    client: Clients.Claude,
  },
  { _tag: "Intended", opId: "op-2", tranche: "t-1", step: { role: Roles.Reviewer, round: 0 }, baseRevision: rev, grantId: "g-2", client: Clients.Codex, waiverId: "w-1" },
  { _tag: "Launched", opId: "op-1", pgid: 4242 },
  { _tag: "Finished", opId: "op-1", outcome: { _tag: "Success" }, endedAt: 9_000 },
  { _tag: "CommitRecorded", opId: "op-1", outcome: { _tag: "NothingToCommit" } },
  { _tag: "Approved", tranche: "t-1", revision: rev, permits: [] },
  { _tag: "Approved", tranche: "t-2", revision: rev, permits: [".github/"], base: head },
  { _tag: "PreApproved", tranche: "t-3", permits: [], stopBefore: true },
  { _tag: "Waived", provider: Clients.Claude, waiverId: "w-1" },
  { _tag: "Released", opId: "op-1" },
  { _tag: "Adopted", revision: head },
  { _tag: "Reconciled", opId: "op-1", resolution: "discard" },
  { _tag: "ReviewQueued", tranche: "t-1", trancheBase: rev, revision: head },
  { _tag: "Unwound", tranches: ["t-2"], atHead: head, target: rev },
  { _tag: "TrancheEnded", tranche: "t-1", end: { _tag: "Passed" } },
  { _tag: "LedgerBound", path: "/ledger/ledger.sqlite" },
  { _tag: "WorktreeIntended", path: "/w", branch: "foreman/alpha", base: rev },
  { _tag: "WorktreeCreated", path: "/w", branch: "foreman/alpha", gitDir: "/g", commonDir: "/c", base: rev },
  { _tag: "Rebased", base: head },
  { _tag: "BaseRequested", base: head, atHead: rev },
  { _tag: "UnwindRequested", target: rev, atHead: head },
  { _tag: "RestoreRequested", worktree: "review" },
  { _tag: "RequestCompleted", position: 7 },
  { _tag: "HoldCreated", hold: { _tag: "Quota", provider: Clients.Claude, windows: [Windows.Weekly], ledgerSeq: 3 } },
] as const

describe("ProjectEvent", () => {
  const decode = Schema.decodeUnknownResult(ProjectEvent)
  const encode = Schema.encodeUnknownResult(ProjectEvent)

  it.each(events)("round-trips %j", (event) => {
    expect(Result.flatMap(decode(event), encode)).toEqual(Result.succeed(event))
  })

  it.each([
    { ...events[2], pgid: -1 },
    { ...events[11], resolution: "maybe" },
    { _tag: "Unknown" },
  ])("rejects %j", (bad) => {
    expect(Result.isFailure(decode(bad))).toBe(true)
  })
})
