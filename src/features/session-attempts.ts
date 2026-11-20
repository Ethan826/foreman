// One attempt of an assisted session as the session fold records it
// (plan "Write protocol"): its intent, then its first recorded brief, the
// first `Launched`, the first `Finished` and the owner's first
// attestation that it ended.
// Later duplicates change nothing, so replaying a log gives one answer.
import { Option } from "effect"
import type {
  BriefRecorded,
  Finished,
  Intended,
  Launched,
  StepEndedByOwner,
} from "../domain/events.ts"
import type { SessionAttempt } from "../domain/session-state.ts"

/** An attempt with only its intent recorded. */
export const newAttempt = (intent: Intended): SessionAttempt => ({
  intent,
  brief: Option.none(),
  launched: Option.none(),
  finished: Option.none(),
  endedByOwner: Option.none(),
})

/** Records the first `BriefRecorded` of an attempt. */
export const briefBy =
  (brief: BriefRecorded) =>
  (attempt: SessionAttempt): SessionAttempt => ({
    ...attempt,
    brief: Option.orElse(attempt.brief, () => Option.some(brief)),
  })

/** Records the first `Launched` of an attempt. */
export const launchedBy =
  (launch: Launched) =>
  (attempt: SessionAttempt): SessionAttempt => ({
    ...attempt,
    launched: Option.orElse(attempt.launched, () => Option.some(launch)),
  })

/** Records the first `Finished` of an attempt. */
export const finishedBy =
  (finish: Finished) =>
  (attempt: SessionAttempt): SessionAttempt => ({
    ...attempt,
    finished: Option.orElse(attempt.finished, () => Option.some(finish)),
  })

/**
 * Records the owner's attestation that an incomplete attempt ended: only
 * the first, and only when it names the attempt's grant (plan
 * "Settlement for owner-ended steps").
 */
export const attestedBy =
  (ended: StepEndedByOwner) =>
  (attempt: SessionAttempt): SessionAttempt =>
    attempt.intent.grantId === ended.grantId && isIncomplete(attempt)
      ? { ...attempt, endedByOwner: Option.orElse(attempt.endedByOwner, () => Option.some(ended)) }
      : attempt

/** Whether an attempt has no `Finished`. */
export const isIncomplete = (attempt: SessionAttempt): boolean =>
  Option.isNone(attempt.finished)
