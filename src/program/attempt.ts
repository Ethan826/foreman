// The launch protocol of `implement`, `review` and `correct` (plan "Write
// protocol", steps 1 to 8). Every log write is one atomic batch through
// `ProjectLog.append`, at the position this command last wrote or read,
// and files are published before the record that names them:
//
// 1. Take the lock, read the log, settle, fold, and check every
//    prerequisite with the plan's snapshot presumed to pass (for
//    `correct`, presumed equal to the reviewed tree). A refusal here
//    stops the command before git stages anything.
// 2. Only then the plan's snapshot step: the attribute-source check
//    again and the snapshot (review and correct). The prerequisites are
//    checked again with the real snapshot.
// 3. Admission and the waiver step (attempt-admission.ts): batches Q, W.
// 4. The brief's exact bytes are published (review item B14). Batch I:
//    the plan's consent events, `Intended`, the `BriefRecorded` naming
//    the brief, then a `WaiverExpired` for every other armed waiver. A `PositionMoved`
//    cancels the grant as a lost race. A refused attempt expires every
//    armed waiver after its refusal (waiver-expiry.ts).
// 5-7. Start the client, batch L, publish the files, batch F
//    (attempt-run.ts).
// 8. Settle again, so the grant is charged at its estimate.
//
// A failure at any point stops the command and records nothing more, so
// the state left matches the plan's crash table; nothing is replayed.
// A2 adds `review` and `correct` by supplying a `LaunchPlan`: its facts
// for the rules, its consent events, its brief, its handoff and decoding.
import { Effect, Option, Result, Schema } from "effect"
import type { Client } from "../domain/clients.ts"
import { BriefRecorded, Intended, type ProjectEvent } from "../domain/events.ts"
import { GrantId, OpId } from "../domain/ids.ts"
import { StepOutcome } from "../domain/outcomes.ts"
import type { Role } from "../domain/roles.ts"
import type { StdoutLine } from "../domain/process.ts"
import type { Correct, Implement, Review } from "../domain/session.ts"
import type { OpenSession, SessionFold, SessionState } from "../domain/session-state.ts"
import type { CommandChecks, SnapshotCheck } from "../features/command-rules.ts"
import { openSessionOf } from "../features/session-phases.ts"
import { foldSession } from "../features/session.ts"
import type { DecodedAttempt } from "../features/step-outcome.ts"
import type { StateFileFailed } from "../runtime/state-files.ts"
import { applySettle, cancelLostRace } from "./admission.ts"
import { admitStep, type Grant } from "./attempt-admission.ts"
import { type AttemptFiles, attemptFiles, runClient } from "./attempt-run.ts"
import { strictText, utf8Bytes } from "./client-output.ts"
import { holdsNow, type LogRead, pinReading, readLog, requireAllowed, worktreeReading } from "./command-start.ts"
import type { SessionContext } from "./session-context.ts"
import { LostRace } from "./session-errors.ts"
import { type AttemptStop, expiriesBeside, expiringOnRefusal } from "./waiver-expiry.ts"

/**
 * The facts a handoff command observes before the rules, without staging
 * anything: the owner's `--attest`, whether the recorded reports are
 * intact, and the snapshot presumed to pass (none for `implement`).
 */
export interface HandoffFacts {
  readonly attested: boolean
  readonly reportsIntact: boolean
  readonly snapshot: Option.Option<SnapshotCheck>
}

/** What a plan prepares from: the open session, its state and the snapshot taken, if any. */
export interface PrepareInput {
  readonly session: OpenSession
  readonly state: SessionState
  readonly snapshot: Option.Option<SnapshotCheck>
}

/** What a plan prepares once the rules allow it, before admission. */
export interface Prepared {
  /** The prompt the client receives. */
  readonly brief: string
  /** The correction round (decision P9); 0 for the implementation. */
  readonly round: number
  /** The events written in batch I before `Intended` (the owner's consent). */
  readonly consent: ReadonlyArray<ProjectEvent>
}

/**
 * One launch command: the rules' command, the role and client it
 * launches, the owner's `--waive`, and the steps that differ by role.
 * Errors of type `E` stop the command like any other failure.
 */
export interface LaunchPlan<E> {
  readonly command: Implement | Review | Correct
  readonly role: Role
  readonly provider: Client
  readonly waive: boolean
  /** The handoff facts before the rules; runs after the settle step and stages nothing. */
  readonly observe: (fold: SessionFold) => Effect.Effect<HandoffFacts, E>
  /** Step 2, once every prerequisite passed: the snapshot taken, none when the plan takes none. */
  readonly snapshot: (session: OpenSession) => Effect.Effect<Option.Option<SnapshotCheck>, E>
  /** The brief, round and consent events, from recorded files only. */
  readonly prepare: (input: PrepareInput) => Effect.Effect<Prepared, E>
  /** The client's argv from the brief and the attempt's files (a fixed profile). */
  readonly argv: (brief: string, files: AttemptFiles) => readonly [string, ...Array<string>]
  /** The handoff bytes once the leader exited, from its files or its output lines; empty when the client gave none. */
  readonly handoff: (files: AttemptFiles, lines: ReadonlyArray<StdoutLine>) => Effect.Effect<Uint8Array, E | StateFileFailed>
  /**
   * The decoded output classification reads, from the lines and the
   * handoff's text; none when the handoff's bytes are not UTF-8 (review
   * finding R04).
   */
  readonly decode: (lines: ReadonlyArray<StdoutLine>, handoff: Option.Option<string>) => DecodedAttempt
  /** Publishes what follows from the handoff's text, before batch F (a review's findings draft); not run when the handoff is not UTF-8. */
  readonly afterHandoff: (session: OpenSession, handoff: string) => Effect.Effect<void, E | StateFileFailed>
}

/** The facts of a command with no handoff: `implement`. */
export const noHandoffFacts: HandoffFacts = { attested: false, reportsIntact: true, snapshot: Option.none() }

/** The attempt ran to batch F and the settle step after it. */
export class AttemptRecorded extends Schema.TaggedClass<AttemptRecorded>()("AttemptRecorded", {
  opId: OpId,
  grantId: GrantId,
  outcome: StepOutcome,
}) {}

/**
 * Runs `plan`'s launch protocol (see the module comment) under the
 * project lock, and returns the attempt's outcome. Fails with
 * `CommandRefused`, `QuotaHeld`, `WaiverRefused` or `LostRace` as the
 * protocol says, and with any capability's failure, after which nothing
 * more is written beyond the expiries of a refusal. The plan's failures
 * must be among the `AttemptStop` failures, each classified for the
 * one-attempt waiver rule (waiver-expiry.ts).
 */
export const runAttempt = <E extends AttemptStop>(context: SessionContext, plan: LaunchPlan<E>) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* context.capabilities.lock
      return yield* expiringOnRefusal(context, launched(context, plan))
    }),
  )

/** The protocol under the lock, from reading the log to the settle step after batch F. */
const launched = <E>(context: SessionContext, plan: LaunchPlan<E>) =>
  Effect.gen(function* () {
    const { capabilities, settings } = context
    const read = yield* readLog(capabilities.log)
    yield* applySettle(capabilities.ledger, read.events, settings.project)
    const fold = foldSession(read.events)
    const { allowedNow, holds, session, snapshot } = yield* checkedLaunch(context, plan, read, fold)
    const prepared = yield* plan.prepare({ session, state: fold.state, snapshot })
    const grant = yield* admitStep(context, plan, { read, fold, holds, waiverStep: allowedNow.waiverStep })
    const intent = intentOf(plan, session, prepared, grant)
    const { recorded, text } = yield* publishedBrief(context, session, grant.opId, prepared.brief)
    const expiries = expiriesBeside(fold.armedWaivers, grant.waiverId)
    const position = yield* appendIntent(context, grant, [...prepared.consent, intent, recorded, ...expiries])
    const outcome = yield* runClient(context, plan, { session, intent, brief: text, position })
    yield* settleNow(context)
    return new AttemptRecorded({ opId: intent.opId, grantId: intent.grantId, outcome })
  })

/**
 * Steps 1 and 2: the prerequisites with the presumed snapshot, then the
 * plan's snapshot step, then the prerequisites again with the snapshot
 * taken. Nothing is staged unless the first check passes.
 */
const checkedLaunch = <E>(context: SessionContext, plan: LaunchPlan<E>, read: LogRead, fold: SessionFold) =>
  Effect.gen(function* () {
    const facts = yield* plan.observe(fold)
    const holds = yield* holdsNow(context, read)
    const worktree = yield* worktreeReading(context, read.events)
    const checks: CommandChecks = {
      lockHeld: true,
      worktreeCheckPassed: Result.isSuccess(worktree.verdict),
      head: worktree.head,
      provider: plan.provider,
      pinMatches: yield* pinReading(context, plan.provider),
      holds,
      ...facts,
    }
    yield* requireAllowed(plan.command, fold.state, checks)
    const session = yield* Effect.fromOption(openSessionOf(fold.state))
    const snapshot = yield* plan.snapshot(session)
    const taken = { ...checks, snapshot: Option.orElse(snapshot, () => checks.snapshot) }
    const allowedNow = yield* requireAllowed(plan.command, fold.state, taken)
    return { allowedNow, holds, session, snapshot }
  })

/** The attempt's `Intended`: the session's tranche and base, the grant and any waiver. */
const intentOf = <E>(plan: LaunchPlan<E>, session: OpenSession, prepared: Prepared, grant: Grant) =>
  new Intended({
    opId: grant.opId,
    tranche: session.opened.tranche,
    step: { role: plan.role, round: prepared.round },
    baseRevision: session.opened.baseRevision,
    grantId: grant.grantId,
    client: plan.provider,
    waiverId: grant.waiverId,
  })

/**
 * Publishes the brief's exact bytes before batch I (review item B14) and
 * returns the `BriefRecorded` that names them, with the text decoded from
 * those bytes, which the argv carries. A failed publication stops the
 * command before batch I, leaving the grant an orphan for the next
 * settle step.
 */
const publishedBrief = (context: SessionContext, session: OpenSession, opId: OpId, brief: string) =>
  Effect.gen(function* () {
    const bytes = yield* utf8Bytes(brief)
    const briefPath = attemptFiles(context.settings.stateDir, session, opId).brief
    const briefSha256 = yield* context.capabilities.stateFiles.publish(briefPath, bytes)
    const { sessionId } = session.opened
    return {
      recorded: new BriefRecorded({ sessionId, opId, briefPath, briefSha256 }),
      text: yield* strictText(briefPath, bytes),
    }
  })

/** Appends batch I; a moved log cancels the grant as a lost race (step 4). */
const appendIntent = (context: SessionContext, grant: Grant, batch: ReadonlyArray<ProjectEvent>) =>
  Effect.catchTag(context.capabilities.log.append(grant.position, batch), "PositionMoved", () =>
    Effect.andThen(
      cancelLostRace(context.capabilities.ledger, grant.grantId),
      Effect.fail(new LostRace({ grantId: grant.grantId })),
    ),
  )

/** Step 8: settles against the log as it is now. */
const settleNow = (context: SessionContext) =>
  Effect.flatMap(readLog(context.capabilities.log), (read) =>
    applySettle(context.capabilities.ledger, read.events, context.settings.project),
  )
