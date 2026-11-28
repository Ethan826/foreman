// The owner's grant of correction rounds (v0.2.0 design, "The correction
// limit"; owner ruling of 2026-11-25): `rounds grant <n> --note <reason>`.
// Like `ruling add`, it takes the lock, reads the log, asks the command
// rules and appends one batch, [`RoundsGranted`]; it launches nothing,
// reads no HEAD and stages nothing. The session's correction limit is
// then `maxCorrections` plus every grant of the session.
import { Effect } from "effect"
import { RoundsGranted } from "../domain/events.ts"
import { GrantRounds } from "../domain/session.ts"
import { openSessionOf } from "../features/session-phases.ts"
import { foldSession } from "../features/session.ts"
import { ownerChecks, readLog, requireAllowed } from "./command-start.ts"
import type { SessionContext } from "./session-context.ts"

/** The owner's options for `rounds grant`. */
export interface GrantRoundsOptions {
  /** `<n>`: how many more corrections, a safe integer of at least 1; the CLI refuses any other. */
  readonly count: number
  /** `--note`: why the owner grants them; the CLI refuses an empty or blank one. */
  readonly note: string
}

/**
 * `rounds grant`: in an open session with no incomplete attempt, appends
 * `RoundsGranted` with the count and the note. Returns it. A count or
 * note the event's schema refuses fails as a defect when the event is
 * built, before anything is appended.
 */
export const grantRounds = (context: SessionContext, options: GrantRoundsOptions) =>
  Effect.scoped(
    Effect.gen(function* () {
      const { capabilities } = context
      yield* capabilities.lock
      const read = yield* readLog(capabilities.log)
      const { state } = foldSession(read.events)
      yield* requireAllowed(new GrantRounds({ count: options.count }), state, ownerChecks(false, []))
      const session = yield* Effect.fromOption(openSessionOf(state))
      const granted = new RoundsGranted({
        sessionId: session.opened.sessionId,
        count: options.count,
        note: options.note,
      })
      yield* capabilities.log.append(read.position, [granted])
      return granted
    }),
  )
