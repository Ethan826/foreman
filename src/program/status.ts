// `status` (plan "Commands and their prerequisites", "Process evidence"):
// shows the session state, every incomplete attempt with its grant, the
// holds in place, the armed waivers, the pin check of each client, the
// worktree check, the integrity of each recorded report file and the
// advisory process evidence. It never takes the lock and never appends
// to the log or the ledger, so it works while another command runs and
// whatever else is broken.
import { Array as Arr, Effect, Match, Option, Result, Schema } from "effect"
import { Client, Clients } from "../domain/clients.ts"
import { Launched } from "../domain/events.ts"
import { Hold } from "../domain/holds.ts"
import { GrantId, OpId } from "../domain/ids.ts"
import { ProcessEvidence } from "../domain/process.ts"
import type { ReportRecorded } from "../domain/session-events.ts"
import { ArmedWaivers, type SessionAttempt, SessionState } from "../domain/session-state.ts"
import { processEvidence } from "../features/process-evidence.ts"
import { openSessionOf } from "../features/session-phases.ts"
import { foldSession } from "../features/session.ts"
import { decodePs } from "../format/ps.ts"
import { holdsNow, pinReading, readLog, worktreeReading } from "./command-start.ts"
import { attemptBriefIntact } from "./brief-files.ts"
import { fileIntact } from "./recorded-files.ts"
import type { SessionContext } from "./session-context.ts"

/** What `status` says about process evidence every time it shows some (plan "Process evidence"). */
export const evidenceCaveat =
  "Advisory evidence, not proof: a listed group may be an unrelated one reusing the id, " +
  "a descendant that left the group is not listed, and nothing listed does not establish " +
  "that the client's processes stopped. Foreman never signals."

/** The process listing could not be read or decoded; `reason` says why. */
export class EvidenceUnavailable extends Schema.TaggedClass<EvidenceUnavailable>()("EvidenceUnavailable", {
  reason: Schema.String,
}) {}

/** The attempt has no `Launched`, so no process was recorded for it. */
export class NotLaunched extends Schema.TaggedClass<NotLaunched>()("NotLaunched", {}) {}

/** One incomplete attempt: its operation, its grant, its launch and the advisory evidence. */
export const IncompleteAttempt = Schema.Struct({
  opId: OpId,
  grantId: GrantId,
  launched: Schema.Option(Launched),
  evidence: Schema.Union([ProcessEvidence, EvidenceUnavailable, NotLaunched]),
})
/** One incomplete attempt in a status report; see {@link IncompleteAttempt}. */
export type IncompleteAttempt = typeof IncompleteAttempt.Type

/** Whether one recorded report's files are present with their recorded hashes. */
export const ReportIntegrity = Schema.Struct({
  opId: OpId,
  rawIntact: Schema.Boolean,
  handoffIntact: Schema.Boolean,
})
/** One report's integrity; see {@link ReportIntegrity}. */
export type ReportIntegrity = typeof ReportIntegrity.Type

/**
 * Whether one attempt's brief is recorded with its file present at the
 * recorded hash (review item B14); an attempt with no brief recorded is
 * not intact.
 */
export const BriefIntegrity = Schema.Struct({ opId: OpId, briefIntact: Schema.Boolean })
/** One brief's integrity; see {@link BriefIntegrity}. */
export type BriefIntegrity = typeof BriefIntegrity.Type

/** The startup worktree check: whether it passed, and the HEAD or the reason. */
export const WorktreeStatus = Schema.Struct({ passed: Schema.Boolean, detail: Schema.String })

/** Everything `status` shows. */
export const StatusReport = Schema.Struct({
  state: SessionState,
  incomplete: Schema.Array(IncompleteAttempt),
  holds: Schema.Array(Hold),
  armedWaivers: ArmedWaivers,
  pinsMatch: Schema.Record(Client, Schema.Boolean),
  worktree: WorktreeStatus,
  reports: Schema.Array(ReportIntegrity),
  briefs: Schema.Array(BriefIntegrity),
  evidenceCaveat: Schema.String,
})
/** A status report; see {@link StatusReport}. */
export type StatusReport = typeof StatusReport.Type

/** Builds the status report (see the module comment). Fails only when the log or ledger cannot be read. */
export const status = (context: SessionContext) =>
  Effect.gen(function* () {
    const read = yield* readLog(context.capabilities.log)
    const fold = foldSession(read.events)
    const worktree = yield* worktreeReading(context, read.events)
    const listing = yield* Effect.result(context.capabilities.readProcesses())
    return {
      state: fold.state,
      incomplete: Arr.map(incompleteOf(fold.state), (attempt) => incompleteAttempt(attempt, listing)),
      holds: yield* holdsNow(context, read),
      armedWaivers: fold.armedWaivers,
      pinsMatch: {
        [Clients.Claude]: yield* pinReading(context, Clients.Claude),
        [Clients.Codex]: yield* pinReading(context, Clients.Codex),
      },
      worktree: Result.match(worktree, {
        onSuccess: (head) => ({ passed: true, detail: head }),
        onFailure: (reason) => ({ passed: false, detail: reason }),
      }),
      reports: yield* Effect.forEach(reportsOf(fold.state), (report) => integrityOf(context, report)),
      briefs: yield* Effect.forEach(attemptsOf(fold.state), (attempt) => briefIntegrityOf(context, attempt)),
      evidenceCaveat,
    } satisfies StatusReport
  })

/** The incomplete attempts a state carries; none outside an incomplete or interrupted session. */
const incompleteOf = (state: SessionState): ReadonlyArray<SessionAttempt> =>
  Match.value(state).pipe(
    Match.tag("AttemptIncomplete", "Interrupted", (open) => open.incomplete),
    Match.orElse(() => []),
  )

/** The open session's recorded reports. */
const reportsOf = (state: SessionState): ReadonlyArray<ReportRecorded> =>
  Option.match(openSessionOf(state), { onNone: () => [], onSome: (session) => session.reports })

/** One incomplete attempt with the evidence the listing gives about its launch. */
const incompleteAttempt = (
  attempt: SessionAttempt,
  listing: Result.Result<string, { readonly reason: string }>,
): IncompleteAttempt => ({
  opId: attempt.intent.opId,
  grantId: attempt.intent.grantId,
  launched: attempt.launched,
  evidence: Option.match(attempt.launched, {
    onNone: () => new NotLaunched(),
    onSome: (launch) => evidenceFor(launch, listing),
  }),
})

/** The evidence for a recorded launch, or why there is none. */
const evidenceFor = (launch: Launched, listing: Result.Result<string, { readonly reason: string }>) =>
  Result.match(Result.flatMap(Result.mapError(listing, (failed) => failed.reason), decodedRows), {
    onFailure: (reason) => new EvidenceUnavailable({ reason }),
    onSuccess: (rows) =>
      processEvidence({ pid: launch.pgid, pgid: launch.pgid, startedAt: launch.leaderStartedAt }, rows),
  })

/** The listing's rows, or why it does not decode. */
const decodedRows = (text: string) => Result.mapError(decodePs(text), (failed) => failed.reason)

/** The open session's attempts. */
const attemptsOf = (state: SessionState): ReadonlyArray<SessionAttempt> =>
  Option.match(openSessionOf(state), { onNone: () => [], onSome: (session) => session.attempts })

/** Whether an attempt's brief is recorded and present with its recorded hash. */
const briefIntegrityOf = (context: SessionContext, attempt: SessionAttempt) =>
  Effect.map(
    attemptBriefIntact(context, attempt),
    (briefIntact): BriefIntegrity => ({ opId: attempt.intent.opId, briefIntact }),
  )

/** Whether a report's two files are present with their recorded hashes. */
const integrityOf = (context: SessionContext, report: ReportRecorded) =>
  Effect.all({
    opId: Effect.succeed(report.opId),
    rawIntact: fileIntact(context, report.rawPath, report.rawSha256),
    handoffIntact: fileIntact(context, report.handoffPath, report.handoffSha256),
  })
