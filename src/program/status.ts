// `status` (plan "Commands and their prerequisites", "Process evidence"):
// shows the session state, every incomplete attempt with its grant, the
// holds in place, the armed waivers, the pin check of each client, the
// worktree check, the integrity of each recorded report and brief, the
// snapshot coverage statement, and the advisory process evidence for
// every attempt of the open session, finished ones included. It runs
// over a `StatusContext`, which holds reads only: no lock, no ledger
// transaction that takes the write lock, and nothing that publishes or
// appends (review item B11). So it works while another command runs and
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
import { snapshotCoverage } from "../format/brief.ts"
import { decodePs } from "../format/ps.ts"
import { holdsFrom, pinReading, readLog, worktreeReading } from "./command-start.ts"
import { attemptBriefIntact } from "./brief-files.ts"
import { fileIntact } from "./recorded-files.ts"
import type { RecordedFileReader } from "./recorded-files.ts"
import type { StatusContext } from "./status-context.ts"

/** What `status` says about process evidence every time it shows some (plan "Process evidence"). */
export const evidenceCaveat =
  "Advisory evidence, not proof: a listed group may be an unrelated one reusing the id, " +
  "a descendant that left the group is not listed, and nothing listed does not establish " +
  "that the client's processes stopped. An attempt with no recorded launch may still have " +
  "started, since the client is spawned before its launch is recorded. Foreman never signals."

/** The process listing could not be read or decoded; `reason` says why. */
export class EvidenceUnavailable extends Schema.TaggedClass<EvidenceUnavailable>()("EvidenceUnavailable", {
  reason: Schema.String,
}) {}

/**
 * The attempt has no `Launched` (review item B12). The client is spawned
 * before batch L is appended, so it may have started and may still run:
 * whether it did is unknown, and no process group was recorded to list.
 */
export class LaunchUnknown extends Schema.TaggedClass<LaunchUnknown>()("LaunchUnknown", {}) {}

/** One incomplete attempt: its operation and its grant, which `step-ended` names. */
export const IncompleteAttempt = Schema.Struct({ opId: OpId, grantId: GrantId })
/** One incomplete attempt in a status report; see {@link IncompleteAttempt}. */
export type IncompleteAttempt = typeof IncompleteAttempt.Type

/**
 * The advisory evidence for one attempt of the open session, finished or
 * not (review item B12): a leader's normal exit does not show that its
 * descendants stopped, so a finished attempt's group is listed too.
 */
export const LaunchEvidence = Schema.Struct({
  opId: OpId,
  finished: Schema.Boolean,
  launched: Schema.Option(Launched),
  evidence: Schema.Union([ProcessEvidence, EvidenceUnavailable, LaunchUnknown]),
})
/** One attempt's evidence in a status report; see {@link LaunchEvidence}. */
export type LaunchEvidence = typeof LaunchEvidence.Type

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
  /** Whether a ledger file was found; without one the ledger reads as no rows. */
  ledgerFound: Schema.Boolean,
  incomplete: Schema.Array(IncompleteAttempt),
  launches: Schema.Array(LaunchEvidence),
  holds: Schema.Array(Hold),
  armedWaivers: ArmedWaivers,
  pinsMatch: Schema.Record(Client, Schema.Boolean),
  worktree: WorktreeStatus,
  reports: Schema.Array(ReportIntegrity),
  briefs: Schema.Array(BriefIntegrity),
  evidenceCaveat: Schema.String,
  /** What a snapshot covers, the statement every review brief carries (review item M01). */
  coverage: Schema.String,
})
/** A status report; see {@link StatusReport}. */
export type StatusReport = typeof StatusReport.Type

/**
 * Builds the status report (see the module comment) from reads alone.
 * A missing ledger reads as no rows, and `ledgerFound` says so. Fails
 * only when the log or the ledger cannot be read.
 */
export const status = (context: StatusContext) =>
  Effect.gen(function* () {
    const read = yield* readLog(context.capabilities.log)
    const fold = foldSession(read.events)
    const worktree = yield* worktreeReading(context, read.events)
    const listing = yield* Effect.result(context.capabilities.readProcesses())
    const ledger = yield* context.capabilities.ledgerRows
    return {
      state: fold.state,
      ledgerFound: Option.isSome(ledger),
      incomplete: Arr.map(incompleteOf(fold.state), incompleteAttempt),
      launches: Arr.map(attemptsOf(fold.state), (attempt) => launchEvidence(attempt, listing)),
      holds: yield* holdsFrom(context, read, Option.getOrElse(ledger, () => ({ entries: [] }))),
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
      coverage: snapshotCoverage,
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

/** One incomplete attempt's operation and grant. */
const incompleteAttempt = (attempt: SessionAttempt): IncompleteAttempt => ({
  opId: attempt.intent.opId,
  grantId: attempt.intent.grantId,
})

/** One attempt with the evidence the listing gives about its launch, if one is recorded. */
const launchEvidence = (
  attempt: SessionAttempt,
  listing: Result.Result<string, { readonly reason: string }>,
): LaunchEvidence => ({
  opId: attempt.intent.opId,
  finished: Option.isSome(attempt.finished),
  launched: attempt.launched,
  evidence: Option.match(attempt.launched, {
    onNone: () => new LaunchUnknown(),
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
const briefIntegrityOf = (context: RecordedFileReader, attempt: SessionAttempt) =>
  Effect.map(
    attemptBriefIntact(context, attempt),
    (briefIntact): BriefIntegrity => ({ opId: attempt.intent.opId, briefIntact }),
  )

/** Whether a report's two files are present with their recorded hashes. */
const integrityOf = (context: RecordedFileReader, report: ReportRecorded) =>
  Effect.all({
    opId: Effect.succeed(report.opId),
    rawIntact: fileIntact(context, report.rawPath, report.rawSha256),
    handoffIntact: fileIntact(context, report.handoffPath, report.handoffSha256),
  })
