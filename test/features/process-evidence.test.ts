// Advisory process evidence (plan "Process evidence"): what a listing
// shows about the recorded leader and its group. Evidence, not proof; it
// never says the processes are gone.
import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import {
  GroupIdReused,
  LeaderIdReused,
  LeaderListed,
  LeaderNotListed,
  LeaderStartUnrecorded,
  NothingListed,
  ProcessesListed,
  type ProcessLeader,
  type ProcessRow,
} from "../../src/domain/process.ts"
import { processEvidence } from "../../src/features/process-evidence.ts"

const started = "Wed Nov 19 10:00:00 2026"
const later = "Wed Nov 19 11:30:00 2026"

const recorded: ProcessLeader = { pid: 500, pgid: 500, startedAt: Option.some(started) }
const unrecorded: ProcessLeader = { pid: 500, pgid: 500, startedAt: Option.none() }

const row = (pid: number, pgid: number, startedAt: string): ProcessRow => ({
  pid,
  pgid,
  startedAt,
  command: `/bin/process ${String(pid)}`,
})

const leader = row(500, 500, started)
const child = row(501, 500, later)
const grandchild = row(502, 500, later)
const unrelated = row(77, 77, started)
const leftGroup = row(503, 503, later)

describe("processEvidence", () => {
  it("lists the leader with the recorded start and every member of its group", () => {
    expect(processEvidence(recorded, [unrelated, leader, child, grandchild])).toEqual(
      new ProcessesListed({ leader: new LeaderListed(), members: [leader, child, grandchild] }),
    )
  })

  it("lists members when the leader is not listed", () => {
    expect(processEvidence(recorded, [unrelated, child])).toEqual(
      new ProcessesListed({ leader: new LeaderNotListed(), members: [child] }),
    )
  })

  it("marks a reused group id when the group's leader has another start time", () => {
    const newLeader = row(500, 500, later)
    expect(processEvidence(recorded, [newLeader, child])).toEqual(
      new ProcessesListed({ leader: new GroupIdReused({ startedAt: later }), members: [newLeader, child] }),
    )
  })

  it("marks a reused leader pid outside the group", () => {
    const reused = row(500, 42, later)
    expect(processEvidence(recorded, [reused])).toEqual(
      new ProcessesListed({ leader: new LeaderIdReused({ startedAt: later, pgid: 42 }), members: [] }),
    )
  })

  it("cannot confirm the leader when no start time was recorded", () => {
    expect(processEvidence(unrecorded, [leader])).toEqual(
      new ProcessesListed({ leader: new LeaderStartUnrecorded({ startedAt: started }), members: [leader] }),
    )
  })

  it("lists nothing when neither the leader nor the group is listed", () => {
    expect(processEvidence(recorded, [unrelated, leftGroup])).toEqual(new NothingListed())
  })

  it("lists nothing for an empty listing", () => {
    expect(processEvidence(recorded, [])).toEqual(new NothingListed())
  })

  it("does not count a process in another group as a member", () => {
    expect(processEvidence(recorded, [row(600, 77, started)])).toEqual(new NothingListed())
  })
})
