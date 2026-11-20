// What the handoff commands (`review`, `correct`, `close --finished`)
// read before they decide (plan "Commands and their prerequisites",
// "Quiescence, inspection and snapshots", "Snapshot identity and raw
// checks"). The rules are checked first with the snapshot presumed to
// pass, on the reviewed tree when there is one, so that a command refused
// for its attestation, its state or its reports stages nothing. Only then
// does `takeSnapshot` run the attribute-source check again and stage the
// worktree, and the rules are checked again with the snapshot taken.
import { Array as Arr, Effect, Option, Schema } from "effect"
import type { OpId } from "../domain/ids.ts"
import { Roles } from "../domain/roles.ts"
import type { ReportRecorded } from "../domain/session-events.ts"
import { AwaitingHandoff, type OpenSession, type SessionAttempt, type SessionState } from "../domain/session-state.ts"
import type { SnapshotRefused } from "../domain/snapshot.ts"
import type { SnapshotCheck } from "../features/command-rules.ts"
import { openSessionOf } from "../features/session-phases.ts"
import type { HandoffFacts } from "./attempt.ts"
import { fileIntact, recordedText } from "./recorded-files.ts"
import type { SessionContext } from "./session-context.ts"
import { RecordedFileChanged } from "./session-errors.ts"

/**
 * The facts of a handoff command before anything is staged: the owner's
 * `attest`, whether the session's reports are intact, and the snapshot
 * `presumed` to pass.
 */
export const handoffFacts = (
  context: SessionContext,
  state: SessionState,
  attest: boolean,
  presumed: Option.Option<SnapshotCheck>,
) =>
  Effect.map(
    Option.match(openSessionOf(state), {
      onNone: () => Effect.succeed(true),
      onSome: (session) => reportsIntact(context, session),
    }),
    (intact): HandoffFacts => ({ attested: attest, reportsIntact: intact, snapshot: presumed }),
  )

/**
 * The snapshot `review`'s first check presumes: one that passes the raw
 * checks. The review rule reads only that, so the tree it names, the
 * session's base revision, is never compared or shown. None with no
 * session open, where the state alone refuses.
 */
export const presumedPassing = (state: SessionState): Option.Option<SnapshotCheck> =>
  Option.map(openSessionOf(state), (session) => ({ tree: session.opened.baseRevision, passedRawChecks: true }))

/**
 * The snapshot the first check of `correct` and `close --finished`
 * presumes: one on the tree the last review was given. None when no
 * review was given a tree, which the rules refuse as no snapshot.
 */
export const presumedOnReviewedTree = (state: SessionState): Option.Option<SnapshotCheck> =>
  Option.flatMap(openSessionOf(state), (session) =>
    Option.map(session.reviewedTree, (tree) => ({ tree, passedRawChecks: true })),
  )

/**
 * Step 2 of the write protocol: the attribute-source check again (plan
 * B11c, through the pinned runner), then the snapshot from the session's
 * base revision. A snapshot the raw checks refuse is a check that did not
 * pass, which the rules then refuse; any other failure stops the command.
 */
export const takeSnapshot = (context: SessionContext, session: OpenSession) =>
  Effect.gen(function* () {
    const git = context.capabilities.handoffGit(session.opened.worktree)
    const base = session.opened.baseRevision
    yield* git.checkAttributes(base)
    return yield* git.snapshot(base).pipe(
      Effect.map((tree): SnapshotCheck => ({ tree, passedRawChecks: true })),
      Effect.catchTag("SnapshotRefused", (refused) => Effect.succeed(refusedCheck(refused))),
    )
  })

/** The handoff the state awaits, if it awaits one. */
export const awaitedHandoff = (state: SessionState): Option.Option<AwaitingHandoff> =>
  Schema.is(AwaitingHandoff)(state) ? Option.some(state) : Option.none()

/**
 * Whether every finished attempt of the session has its report recorded
 * for this session, with both files present at their recorded hashes. A
 * report recorded for another session does not count.
 */
export const reportsIntact = (context: SessionContext, session: OpenSession) =>
  Effect.map(
    Effect.forEach(Arr.filter(session.attempts, isFinished), (attempt) =>
      Option.match(reportOf(session, attempt.intent.opId), {
        onNone: () => Effect.succeed(false),
        onSome: (report) => reportFilesIntact(context, report),
      }),
    ),
    Arr.every((intact) => intact),
  )

/** The report recorded for attempt `opId` in the session. */
export const reportOf = (session: OpenSession, opId: OpId): Option.Option<ReportRecorded> =>
  Arr.findLast(session.reports, (report) => report.opId === opId)

/**
 * The handoff text of attempt `opId`, read from its recorded file. Fails
 * with {@link RecordedFileChanged} when the report or its file is missing
 * or changed.
 */
export const handoffTextOf = (context: SessionContext, session: OpenSession, opId: OpId) =>
  Effect.flatMap(
    Effect.fromOption(reportOf(session, opId), () => new RecordedFileChanged({ path: opId })),
    (report) => recordedText(context, report.handoffPath, report.handoffSha256),
  )

/** The latest finished implementer or corrector attempt: the one a review or a correction follows. */
export const lastEdit = (session: OpenSession): Option.Option<SessionAttempt> =>
  Arr.findLast(session.attempts, (attempt) => isFinished(attempt) && attempt.intent.step.role !== Roles.Reviewer)

/** Whether an attempt has its `Finished`. */
const isFinished = (attempt: SessionAttempt): boolean => Option.isSome(attempt.finished)

/** Whether both of a report's files are intact. */
const reportFilesIntact = (context: SessionContext, report: ReportRecorded) =>
  Effect.zipWith(
    fileIntact(context, report.rawPath, report.rawSha256),
    fileIntact(context, report.handoffPath, report.handoffSha256),
    (raw, handoff) => raw && handoff,
  )

/** A snapshot the raw checks refused, as a check that did not pass. */
const refusedCheck = (refused: SnapshotRefused): SnapshotCheck => ({ tree: refused.tree, passedRawChecks: false })
