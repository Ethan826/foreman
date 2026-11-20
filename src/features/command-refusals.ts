// Why a session command is refused (plan "Commands and their
// prerequisites"): one tagged reason per prerequisite that failed. The
// command rules in command-rules.ts return every reason that applies, so
// the owner sees all of them at once.
import { Array as Arr, Option, Schema } from "effect"
import { Client } from "../domain/clients.ts"
import { Hold } from "../domain/holds.ts"
import { GrantId, OpId, Revision } from "../domain/ids.ts"
import type { StepEnded } from "../domain/session.ts"
import { type SessionAttempt, SessionState } from "../domain/session-state.ts"
import { openSessionOf } from "./session-phases.ts"

/** The command needs the project's lock, and the caller does not hold it. */
export class LockNotHeld extends Schema.TaggedClass<LockNotHeld>()(
  "LockNotHeld",
  {},
) {}

/** The session is in `state`, which this command does not accept. */
export class WrongState extends Schema.TaggedClass<WrongState>()(
  "WrongState",
  { state: SessionState },
) {}

/** The startup worktree check (B11a to B11d) did not pass. */
export class WorktreeCheckFailed extends Schema.TaggedClass<WorktreeCheckFailed>()(
  "WorktreeCheckFailed",
  {},
) {}

/** The installed version of `provider`, the client to launch, is not the pinned one. */
export class PinMismatch extends Schema.TaggedClass<PinMismatch>()(
  "PinMismatch",
  { provider: Client },
) {}

/** `hold` blocks the command: any hold but a quota hold blocks every launch. */
export class HeldBy extends Schema.TaggedClass<HeldBy>()("HeldBy", {
  hold: Hold,
}) {}

/** A recorded report file is missing or its hash no longer matches. */
export class ReportsNotIntact extends Schema.TaggedClass<ReportsNotIntact>()(
  "ReportsNotIntact",
  {},
) {}

/** The command needs the owner's `--attest` (decision P12), and it was not given. */
export class NotAttested extends Schema.TaggedClass<NotAttested>()(
  "NotAttested",
  {},
) {}

/** No snapshot was taken, or the one taken failed the raw checks. */
export class SnapshotRefused extends Schema.TaggedClass<SnapshotRefused>()(
  "SnapshotRefused",
  {},
) {}

/**
 * The snapshot `current` differs from the tree the review was given,
 * `reviewed` (none when no review was handed a tree). The review is stale.
 */
export class TreeChanged extends Schema.TaggedClass<TreeChanged>()(
  "TreeChanged",
  { reviewed: Schema.Option(Revision), current: Revision },
) {}

/** The session already launched `corrections` corrections, its bound (decision P9). */
export class CorrectionsExhausted extends Schema.TaggedClass<CorrectionsExhausted>()(
  "CorrectionsExhausted",
  { corrections: Schema.Int },
) {}

/** Attempt `opId` is not an incomplete attempt of the open session. */
export class NotIncomplete extends Schema.TaggedClass<NotIncomplete>()(
  "NotIncomplete",
  { opId: OpId },
) {}

/** Grant `grantId` is not the grant of attempt `opId`. */
export class WrongGrant extends Schema.TaggedClass<WrongGrant>()(
  "WrongGrant",
  { opId: OpId, grantId: GrantId },
) {}

/** The owner already attested that attempt `opId` ended. */
export class AlreadyAttested extends Schema.TaggedClass<AlreadyAttested>()(
  "AlreadyAttested",
  { opId: OpId },
) {}

/** Schema for any reason a command is refused. */
export const Refusal = Schema.Union([
  LockNotHeld,
  WrongState,
  WorktreeCheckFailed,
  PinMismatch,
  HeldBy,
  ReportsNotIntact,
  NotAttested,
  SnapshotRefused,
  TreeChanged,
  CorrectionsExhausted,
  NotIncomplete,
  WrongGrant,
  AlreadyAttested,
])
/** Any reason a command is refused; see {@link Refusal}. */
export type Refusal = typeof Refusal.Type

/**
 * Why `step-ended` may not record `ended` in `state`: the owner may
 * attest the end of an attempt of the open session that has no
 * `Finished`, with that attempt's grant, once (plan "Settlement for
 * owner-ended steps"). None when it may.
 */
export const stepEndedRefusals = (
  ended: StepEnded,
  state: SessionState,
): ReadonlyArray<Refusal> =>
  Option.match(openSessionOf(state), {
    onNone: () => [new WrongState({ state })],
    onSome: (session) =>
      Option.match(
        Arr.findFirst(session.attempts, (attempt) => attempt.intent.opId === ended.opId),
        {
          onNone: () => [new NotIncomplete({ opId: ended.opId })],
          onSome: attemptRefusals(ended),
        },
      ),
  })

/**
 * Why the owner may not attest the end of `attempt` now: it finished,
 * the grant is not its own, or its end is already attested.
 */
const attemptRefusals =
  (ended: StepEnded) =>
  (attempt: SessionAttempt): ReadonlyArray<Refusal> =>
    Option.isSome(attempt.finished)
      ? [new NotIncomplete({ opId: ended.opId })]
      : attempt.intent.grantId !== ended.grantId
        ? [new WrongGrant({ opId: ended.opId, grantId: ended.grantId })]
        : Option.isSome(attempt.endedByOwner)
          ? [new AlreadyAttested({ opId: ended.opId })]
          : []
