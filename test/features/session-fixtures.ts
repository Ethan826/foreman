// Shared log events for the session fold, command rule and owner-ended
// settle tests. Attempt n has opId op-n and grant g-n.
import { Option } from "effect"
import { type Client, Clients } from "../../src/domain/clients.ts"
import {
  Finished,
  HandoffApproved,
  HandoffRejected,
  Intended,
  Launched,
  ReportRecorded,
  SessionClosed,
  SessionOpened,
  StepEndedByOwner,
  Waived,
} from "../../src/domain/events.ts"
import { GrantId, OpId, Revision, TrancheId, WaiverId } from "../../src/domain/ids.ts"
import type { StepOutcome } from "../../src/domain/outcomes.ts"
import { type Role, Roles } from "../../src/domain/roles.ts"
import { Attestations, type CloseKind, SessionId, Sha256 } from "../../src/domain/session.ts"

export const sessionId = SessionId.make("s-1")
export const base = Revision.make("a".repeat(40))
export const treeA = Revision.make("b".repeat(40))
export const treeB = Revision.make("c".repeat(40))
export const hash = Sha256.make("d".repeat(64))

export const opId = (n: number) => OpId.make(`op-${String(n)}`)
export const grantId = (n: number) => GrantId.make(`g-${String(n)}`)

export const opened = (id = sessionId) =>
  new SessionOpened({
    sessionId: id,
    tranche: TrancheId.make("t-1"),
    taskPath: "/state/task.md",
    taskSha256: hash,
    baseRevision: base,
    worktree: { path: "/w", gitDir: "/g", commonDir: "/c" },
  })

const clientOf = (role: Role): Client => (role === Roles.Reviewer ? Clients.Codex : Clients.Claude)

export const intended = (n: number, role: Role = Roles.Implementer) =>
  new Intended({
    opId: opId(n),
    tranche: TrancheId.make("t-1"),
    step: { role, round: 0 },
    baseRevision: base,
    grantId: grantId(n),
    client: clientOf(role),
    waiverId: Option.none(),
  })

export const launched = (n: number) =>
  new Launched({ opId: opId(n), pgid: 100 + n, leaderStartedAt: Option.none() })

export const finished = (n: number, outcome: StepOutcome, endedAt = 500) =>
  new Finished({ opId: opId(n), outcome, endedAt })

export const reported = (n: number, role: Role = Roles.Implementer) =>
  new ReportRecorded({
    sessionId,
    opId: opId(n),
    role,
    rawPath: `/state/op-${String(n)}.jsonl`,
    rawSha256: hash,
    handoffPath: `/state/op-${String(n)}.md`,
    handoffSha256: hash,
  })

export const endedByOwner = (n: number, grant = grantId(n), endedAt = 900) =>
  new StepEndedByOwner({ opId: opId(n), grantId: grant, endedAt })

export const approved = (from: number, toRole: Role, tree = treeA) =>
  new HandoffApproved({
    sessionId,
    fromOpId: opId(from),
    toRole,
    tree,
    findingsSha256: toRole === Roles.Corrector ? Option.some(hash) : Option.none(),
    attests: Attestations.QuiescenceAndInspection,
  })

export const rejected = (from: number) =>
  new HandoffRejected({ sessionId, fromOpId: opId(from), note: "no" })

export const closed = (how: CloseKind, id = sessionId) =>
  new SessionClosed({ sessionId: id, how, note: "", attests: Option.none() })

export const waived = (provider: Client, id = "w-1") =>
  new Waived({ provider, waiverId: WaiverId.make(id) })
