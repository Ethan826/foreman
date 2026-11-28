// The states of an assisted session (plan "Commands and their
// prerequisites", "Outcomes and usable attempts"): what the project log
// says about the current session, as Features folds it. Each open state
// carries the session's facts; the command rules read the state's tag.
import { Schema } from "effect"
import { Client } from "./clients.ts"
import { OpId, Revision, WaiverId } from "./ids.ts"
import { StepOutcome } from "./outcomes.ts"
import { Role } from "./roles.ts"
import { GrantedRounds, OverruledFinding, Ruling } from "./rulings.ts"
import { CloseKind, SessionId } from "./session.ts"
import {
  BriefRecorded,
  FindingsRecorded,
  ReportRecorded,
  SessionOpened,
  StepEndedByOwner,
} from "./session-events.ts"
import { Finished, Intended, Launched } from "./step-events.ts"

/**
 * One attempt of the session: its `Intended`, and the brief, `Launched`,
 * `Finished` and owner attestation recorded for it so far. An attempt
 * with no `Finished` is incomplete.
 */
export const SessionAttempt = Schema.Struct({
  intent: Intended,
  brief: Schema.Option(BriefRecorded),
  launched: Schema.Option(Launched),
  finished: Schema.Option(Finished),
  endedByOwner: Schema.Option(StepEndedByOwner),
})
/** One attempt; see {@link SessionAttempt}. */
export type SessionAttempt = typeof SessionAttempt.Type

/**
 * The facts of an open session: how it was opened, its attempts in log
 * order, its recorded reports, the number of corrections launched (each
 * corrector `Intended`; plan decision P9 sets the default limit at two,
 * which the owner's `rounds grant` raises), the tree
 * the latest review was given, if a review was handed one, and (v0.2.0)
 * the owner's rulings in session order with their supersede marks, each
 * usable review's recorded findings, the overruled findings, each
 * named by its review and its finding id together, and the session's
 * grants of correction rounds in log order (`RoundsGranted`; the limit
 * they raise is computed from them, not stored). All are plain arrays
 * and structs, since `status` prints the state encoded.
 */
export const OpenSession = Schema.Struct({
  opened: SessionOpened,
  attempts: Schema.Array(SessionAttempt),
  reports: Schema.Array(ReportRecorded),
  corrections: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  reviewedTree: Schema.Option(Revision),
  rulings: Schema.Array(Ruling),
  findings: Schema.Array(FindingsRecorded),
  overrules: Schema.Array(OverruledFinding),
  roundsGranted: Schema.Array(GrantedRounds),
})
/** An open session's facts; see {@link OpenSession}. */
export type OpenSession = typeof OpenSession.Type

/** No session was ever opened in this project. */
export class NoSession extends Schema.TaggedClass<NoSession>()(
  "NoSession",
  {},
) {}

/** The latest session, `sessionId`, closed `how`; none is open. */
export class SessionEnded extends Schema.TaggedClass<SessionEnded>()(
  "SessionEnded",
  { sessionId: SessionId, how: CloseKind },
) {}

/** A session is open and has no attempt yet. */
export class OpenNoAttempt extends Schema.TaggedClass<OpenNoAttempt>()(
  "OpenNoAttempt",
  { session: OpenSession },
) {}

/**
 * At least one attempt is incomplete (`Intended`, no `Finished`) and at
 * least one of those has no owner attestation. It may still run; nothing
 * but `status`, `step-ended` and, after it, `close --interrupted` goes on.
 */
export class AttemptIncomplete extends Schema.TaggedClass<AttemptIncomplete>()(
  "AttemptIncomplete",
  { session: OpenSession, incomplete: Schema.Array(SessionAttempt) },
) {}

/**
 * Every incomplete attempt has the owner's `StepEndedByOwner` (plan
 * decision P6): the session may only close `interrupted`.
 */
export class Interrupted extends Schema.TaggedClass<Interrupted>()(
  "Interrupted",
  { session: OpenSession, incomplete: Schema.Array(SessionAttempt) },
) {}

/**
 * The last attempt, `opId` in role `role`, finished with `outcome` and
 * waits for the owner's handoff command. `usable` says whether the
 * outcome lets the session go on (plan "Outcomes and usable attempts");
 * an unusable one allows only `ruling add`, `rounds grant` and
 * `close --abandoned` (decision P11; `ruling add` is allowed in every
 * `AwaitingHandoff`, v0.2.0, dogfood-6b, and `rounds grant` likewise,
 * dogfood-7).
 */
export class AwaitingHandoff extends Schema.TaggedClass<AwaitingHandoff>()(
  "AwaitingHandoff",
  {
    session: OpenSession,
    opId: OpId,
    role: Role,
    outcome: StepOutcome,
    usable: Schema.Boolean,
  },
) {}

/**
 * The owner rejected attempt `fromOpId`'s handoff; only `ruling add`,
 * `rounds grant` and `close --abandoned` remain.
 */
export class Rejected extends Schema.TaggedClass<Rejected>()("Rejected", {
  session: OpenSession,
  fromOpId: OpId,
}) {}

/** Any session state; see the members. */
export const SessionState = Schema.Union([
  NoSession,
  SessionEnded,
  OpenNoAttempt,
  AttemptIncomplete,
  Interrupted,
  AwaitingHandoff,
  Rejected,
])
/** A session state; see {@link SessionState}. */
export type SessionState = typeof SessionState.Type

/** The waiver armed for each provider, if any (design "Waivers"). */
export const ArmedWaivers = Schema.Record(Client, Schema.Option(WaiverId))
/** The armed waivers; see {@link ArmedWaivers}. */
export type ArmedWaivers = typeof ArmedWaivers.Type

/** The session fold's result: the state and the armed waivers. */
export const SessionFold = Schema.Struct({
  state: SessionState,
  armedWaivers: ArmedWaivers,
})
/** The session fold's result; see {@link SessionFold}. */
export type SessionFold = typeof SessionFold.Type
