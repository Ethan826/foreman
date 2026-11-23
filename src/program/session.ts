// The owner's session commands that launch nothing (plan "Commands and
// their prerequisites", "Settlement for owner-ended steps", "Close
// rules"): `session open`, `step-ended` and `session close --abandoned |
// --interrupted`. Each takes the lock, reads the log, asks the command
// rules, and appends one batch. Open needs the worktree check and no
// non-quota hold; step-ended and close need neither, so the owner's exits
// stay open when the worktree or a client is broken. `status` is in
// status.ts.
import { Array as Arr, Clock, Effect, Option, Record, Result } from "effect"
import { Approved, SessionClosed, SessionOpened, StepEndedByOwner, WaiverExpired } from "../domain/events.ts"
import type { GrantId, OpId, TrancheId } from "../domain/ids.ts"
import { type CloseKind, SessionClose, SessionId, SessionOpen, StepEnded } from "../domain/session.ts"
import type { SessionFold } from "../domain/session-state.ts"
import { openSessionOf } from "../features/session-phases.ts"
import { foldSession } from "../features/session.ts"
import { applySettle } from "./admission.ts"
import { holdsNow, ownerChecks, readLog, recordedWorktree, requireAllowed, worktreeReading } from "./command-start.ts"
import { type SessionCapabilities, type SessionContext, type SessionSettings, WorktreeUnready } from "./session-context.ts"

/** The owner's options for `session open`. */
export interface OpenOptions {
  readonly tranche: TrancheId
  /** The task file to copy into the state directory and record. */
  readonly taskFile: string
}

/** The owner's options for `session close`. */
export interface CloseOptions {
  /** `abandoned` or `interrupted`; `finished` is `closeFinished` in handoff.ts. */
  readonly how: CloseKind
  readonly note: string
}

/**
 * What the owner's exits, `step-ended` and `session close --abandoned |
 * --interrupted`, run over: the log, the ledger, the lock and the
 * project, and nothing that runs git (re-review R02; plan "Commands and
 * their prerequisites"). A `SessionContext` is one, so a test may pass
 * either.
 */
export interface ExitContext {
  readonly capabilities: Pick<SessionCapabilities, "log" | "ledger" | "lock">
  readonly settings: Pick<SessionSettings, "project">
}

/**
 * What `step-ended` runs over: the log and the lock, and not the ledger,
 * which it never reads or writes (focused review finding 2). An
 * `ExitContext` or a `SessionContext` is one, so a test may pass either.
 */
export interface StepEndedContext {
  readonly capabilities: Pick<SessionCapabilities, "log" | "lock">
}

/** The owner's attestation for `step-ended`. */
export interface StepEndedOptions {
  readonly opId: OpId
  readonly grantId: GrantId
}

/**
 * `session open`: with no session open, the worktree check passing and
 * no non-quota hold, publishes a copy of the task file in the state
 * directory and appends `SessionOpened` and `Approved` for the tranche at
 * the worktree's HEAD in one batch. Returns the `SessionOpened`.
 */
export const openSession = (context: SessionContext, options: OpenOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { capabilities, settings } = context
      yield* capabilities.lock
      const read = yield* readLog(capabilities.log)
      const worktree = yield* worktreeReading(context, read.events)
      const holds = yield* holdsNow(context, read)
      yield* requireAllowed(new SessionOpen(), foldSession(read.events).state, ownerChecks(Result.isSuccess(worktree.verdict), holds))
      const head = yield* Effect.mapError(Effect.fromResult(worktree.verdict),(reason) => new WorktreeUnready({ reason }))
      const recorded = yield* Effect.fromOption(recordedWorktree(read.events))
      const sessionId = SessionId.make(yield* capabilities.newId)
      const taskPath = `${settings.stateDir}/${sessionId}.task.md`
      const taskSha256 = yield* capabilities.stateFiles.publish(taskPath, yield* capabilities.stateFiles.read(options.taskFile))
      const opened = new SessionOpened({
        sessionId,
        tranche: options.tranche,
        taskPath,
        taskSha256,
        baseRevision: head,
        worktree: { path: recorded.path, gitDir: recorded.gitDir, commonDir: recorded.commonDir },
      })
      const approved = new Approved({ tranche: options.tranche, revision: head, permits: [], base: Option.none() })
      yield* capabilities.log.append(read.position, [opened, approved])
      return opened
    }),
  )

/**
 * `step-ended <opId> --grant <grantId>`: the owner attests that the
 * incomplete attempt `opId`, reserved by `grantId`, has ended. Appends
 * `StepEndedByOwner` at the wall clock now; refused for a finished or
 * unknown attempt, another grant, or a second attestation. Only the
 * operation and the grant are taken from `options`, so the facade's
 * tagged command can be passed as it is.
 */
export const stepEnded = (context: StepEndedContext, options: StepEndedOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { capabilities } = context
      yield* capabilities.lock
      const read = yield* readLog(capabilities.log)
      const command = new StepEnded({ opId: options.opId, grantId: options.grantId })
      yield* requireAllowed(command, foldSession(read.events).state, ownerChecks(false, []))
      const endedAt = yield* Clock.currentTimeMillis
      const ended = new StepEndedByOwner({ opId: options.opId, grantId: options.grantId, endedAt })
      yield* capabilities.log.append(read.position, [ended])
      return ended
    }),
  )

/**
 * `session close --abandoned | --interrupted [--note]`: runs the settle
 * step, then, if the close rules allow it, appends `SessionClosed` and a
 * `WaiverExpired` for every armed waiver in one batch. It releases no
 * hold, deletes no file and changes no grant except through settlement.
 */
export const closeSession = (context: ExitContext, options: CloseOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { capabilities, settings } = context
      yield* capabilities.lock
      const read = yield* readLog(capabilities.log)
      yield* applySettle(capabilities.ledger, read.events, settings.project)
      const fold = foldSession(read.events)
      yield* requireAllowed(new SessionClose({ how: options.how }), fold.state, ownerChecks(false, []))
      const session = yield* Effect.fromOption(openSessionOf(fold.state))
      const closed = new SessionClosed({
        sessionId: session.opened.sessionId,
        how: options.how,
        note: options.note,
        attests: Option.none(),
      })
      yield* capabilities.log.append(read.position, [closed, ...waiverExpiries(fold)])
      return closed
    }),
  )

/** A `WaiverExpired` for every armed waiver, which every close appends (plan "Close rules"). */
export const waiverExpiries = (fold: SessionFold): ReadonlyArray<WaiverExpired> =>
  Arr.map(Arr.getSomes(Record.values(fold.armedWaivers)), (waiverId) => new WaiverExpired({ waiverId }))
