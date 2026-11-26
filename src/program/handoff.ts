// The owner's handoff commands that launch nothing (plan "Slice A2",
// "Close rules"): `reject [--note]` and `session close --finished
// --attest`. Each takes the lock, reads the log, asks the command rules
// and appends one batch. `reject` needs only a usable attempt awaiting
// its handoff and appends [`HandoffRejected`]; afterwards only `ruling
// add` and `close --abandoned` remain. `close --finished` runs the settle step, checks
// its rules with the snapshot presumed equal to the reviewed tree, and
// only then reads the worktree's HEAD with `git rev-parse HEAD` alone,
// with no identity or attribute check, through the runner pinned to the
// session's recorded identity. A HEAD that moved from the session's base
// is refused (`HeadMoved`, owner ruling of 2026-11-23) before anything is
// staged; a read that fails keeps its own failure. Then it runs the
// attribute check again and takes the snapshot, so a close refused for
// its attestation, its state or its HEAD stages nothing. With the
// snapshot on the reviewed tree it appends [`ReviewChecked`,
// `SessionClosed`] and a `WaiverExpired` for every armed waiver; a
// changed tree refuses and appends nothing.
import { Effect, Option } from "effect"
import { HandoffRejected, ReviewChecked, SessionClosed } from "../domain/events.ts"
import type { Revision } from "../domain/ids.ts"
import { Attestations, CloseKinds, Reject, SessionClose } from "../domain/session.ts"
import type { OpenSession, SessionFold } from "../domain/session-state.ts"
import { openSessionOf } from "../features/session-phases.ts"
import { foldSession } from "../features/session.ts"
import { applySettle } from "./admission.ts"
import { ownerChecks, readLog, requireAllowed } from "./command-start.ts"
import { awaitedHandoff, presumedOnReviewedTree, takeSnapshot } from "./handoff-facts.ts"
import type { SessionContext } from "./session-context.ts"
import { waiverExpiries } from "./session.ts"

/** The owner's options for `reject`. */
export interface RejectOptions {
  /** Why the owner rejects the handoff; empty when none was given. */
  readonly note: string
}

/** The owner's options for `session close --finished`. */
export interface FinishOptions {
  readonly note: string
  /** `--attest`: quiescence and inspection since the last attempt (decision P12). */
  readonly attest: boolean
}

/**
 * `reject [--note]`: with a usable attempt awaiting its handoff, appends
 * `HandoffRejected` naming that attempt. Returns the `HandoffRejected`.
 */
export const reject = (context: SessionContext, options: RejectOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { capabilities } = context
      yield* capabilities.lock
      const read = yield* readLog(capabilities.log)
      const { state } = foldSession(read.events)
      yield* requireAllowed(new Reject(), state, ownerChecks(false, []))
      const awaited = yield* Effect.fromOption(awaitedHandoff(state))
      const rejected = new HandoffRejected({
        sessionId: awaited.session.opened.sessionId,
        fromOpId: awaited.opId,
        note: options.note,
      })
      yield* capabilities.log.append(read.position, [rejected])
      return rejected
    }),
  )

/**
 * `session close --finished --attest [--note]` (see the module comment).
 * Returns the `SessionClosed`.
 */
export const closeFinished = (context: SessionContext, options: FinishOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { capabilities, settings } = context
      yield* capabilities.lock
      const read = yield* readLog(capabilities.log)
      yield* applySettle(capabilities.ledger, read.events, settings.project)
      const fold = foldSession(read.events)
      const command = new SessionClose({ how: CloseKinds.Finished })
      const checks = { ...ownerChecks(false, []), attested: options.attest, snapshot: presumedOnReviewedTree(fold.state) }
      yield* requireAllowed(command, fold.state, checks)
      const session = yield* Effect.fromOption(openSessionOf(fold.state))
      const head = Option.some(yield* capabilities.handoffGit(session.opened.worktree).readHead())
      // A refused close leaves waivers as they are (owner ruling, dogfood-3a round 1).
      yield* requireAllowed(command, fold.state, { ...checks, head })
      const snapshot = yield* takeSnapshot(context, session)
      yield* requireAllowed(command, fold.state, { ...checks, head, snapshot: Option.some(snapshot) })
      const { batch, closed } = yield* finishedBatch(fold, session, snapshot.tree, options.note)
      yield* capabilities.log.append(read.position, batch)
      return closed
    }),
  )

/** The close's batch: `ReviewChecked`, `SessionClosed` and the waivers' expiries. */
const finishedBatch = (fold: SessionFold, session: OpenSession, currentTree: Revision, note: string) =>
  Effect.gen(function* () {
    const review = yield* Effect.fromOption(awaitedHandoff(fold.state))
    const { sessionId } = session.opened
    const checked = new ReviewChecked({
      sessionId,
      reviewOpId: review.opId,
      reviewedTree: yield* Effect.fromOption(session.reviewedTree),
      currentTree,
    })
    const closed = new SessionClosed({
      sessionId,
      how: CloseKinds.Finished,
      note,
      attests: Option.some(Attestations.QuiescenceAndInspection),
    })
    return { batch: [checked, closed, ...waiverExpiries(fold)], closed }
  })
