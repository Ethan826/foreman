// The expiries of the one-attempt waiver rule in a launch command
// (design "Waivers"; review items B15 and R01). An admitted attempt
// expires, in batch I, every armed waiver its `Intended` does not name.
// An attempt stopped by a deliberate refusal decides with the waivers as
// it read them, then, still under the lock, appends a `WaiverExpired` for
// every waiver armed at that point. A storage failure, a failed git or
// process call, and a crash (a defect or an interruption) expire nothing,
// so the retry after batch W still launches with its waiver.
//
// Every typed failure a launch attempt can stop with is classified in
// `isRefusal`, an exhaustive match over the tags of `AttemptStop`. A
// launch whose error type holds a failure outside `AttemptStop` does not
// compile, and neither does a match that leaves a tag of `AttemptStop`
// out, so a new failure cannot slip past the rule unclassified.
import { Array as Arr, type Cause, Effect, Match, Option } from "effect"
import { constant } from "effect/Function"
import type { AttributeSourcesRefused } from "../domain/attributes.ts"
import { type PositionMoved, type ProjectLogError, WaiverExpired } from "../domain/events.ts"
import type { WaiverId } from "../domain/ids.ts"
import type { GrantSettled, LedgerBusy, LedgerError } from "../domain/ledger.ts"
import type { ClientStartFailed } from "../domain/process.ts"
import type { ArmedWaivers } from "../domain/session-state.ts"
import type {
  SnapshotIndexFailed,
  SnapshotObjectFormatRefused,
  SnapshotPreflightRefused,
  SnapshotRefused,
  SnapshotStepFailed,
} from "../domain/snapshot.ts"
import type { GitCommandFailed } from "../domain/worktree.ts"
import { foldSession } from "../features/session.ts"
import { unusedWaivers } from "../features/waiver.ts"
import type { ProfilePathUnsafe } from "../format/claude-settings.ts"
import type { RawOutputFailed } from "../runtime/spawn.ts"
import type { StateFileFailed } from "../runtime/state-files.ts"
import { readLog } from "./command-start.ts"
import type { SessionContext } from "./session-context.ts"
import type {
  ChangedPathsUnread,
  CommandRefused,
  FindingsFileUnreadable,
  LostRace,
  QuotaHeld,
  RecordedFileChanged,
  TaskFileChanged,
  WaiverRefused,
} from "./session-errors.ts"

/** Every typed failure a launch attempt (`implement`, `review`, `correct`) may stop with under the lock. */
export type AttemptStop =
  | AttributeSourcesRefused
  | ChangedPathsUnread
  | ClientStartFailed
  | CommandRefused
  | FindingsFileUnreadable
  | GitCommandFailed
  | GrantSettled
  | LedgerBusy
  | LedgerError
  | LostRace
  | Cause.NoSuchElementError
  | PositionMoved
  | ProfilePathUnsafe
  | ProjectLogError
  | QuotaHeld
  | RawOutputFailed
  | RecordedFileChanged
  | SnapshotIndexFailed
  | SnapshotObjectFormatRefused
  | SnapshotPreflightRefused
  | SnapshotRefused
  | SnapshotStepFailed
  | StateFileFailed
  | TaskFileChanged
  | WaiverRefused

/** A deliberate refusal: every armed waiver expires. */
const refusal = constant(true)

/** A failure to read, write or run: no waiver expires. */
const failure = constant(false)

/**
 * Whether a failure is a deliberate refusal, which expires every armed
 * waiver, or a failure to read, write or run, which expires none. A
 * refusal is foreman deciding, from what it read, that the attempt must
 * not launch: the rules, quota, a refused `--waive`, a lost race at
 * batch I, a changed recorded file, an unreadable findings file, an
 * unsafe profile path, refused attribute sources and the snapshot's
 * refusals. A failure is a store, file, git command or process that did
 * not do its work, after which a retry may succeed with the same
 * consent. `NoSuchElementError` arises only when state the rules
 * required is missing, which is a fault, not a decision.
 * `ClientStartFailed` and `RawOutputFailed` come after batch I, which
 * already settled every waiver.
 */
export const isRefusal: (stop: AttemptStop) => boolean = Match.type<AttemptStop>().pipe(
  Match.tagsExhaustive({
    AttributeSourcesRefused: refusal,
    ChangedPathsUnread: failure,
    ClientStartFailed: failure,
    CommandRefused: refusal,
    FindingsFileUnreadable: refusal,
    GitCommandFailed: failure,
    GrantSettled: failure,
    LedgerBusy: failure,
    LedgerError: failure,
    LostRace: refusal,
    NoSuchElementError: failure,
    PositionMoved: failure,
    ProfilePathUnsafe: refusal,
    ProjectLogError: failure,
    QuotaHeld: refusal,
    RawOutputFailed: failure,
    RecordedFileChanged: refusal,
    SnapshotIndexFailed: failure,
    SnapshotObjectFormatRefused: refusal,
    SnapshotPreflightRefused: refusal,
    SnapshotRefused: refusal,
    SnapshotStepFailed: failure,
    StateFileFailed: failure,
    TaskFileChanged: refusal,
    WaiverRefused: refusal,
  }),
)

/** A `WaiverExpired` for every waiver in `armed` but `used`. */
export const expiriesBeside = (armed: ArmedWaivers, used: Option.Option<WaiverId>): ReadonlyArray<WaiverExpired> =>
  Arr.map(unusedWaivers(armed, used), (waiverId) => new WaiverExpired({ waiverId }))

/**
 * Runs `attempt`; when it fails with a failure {@link isRefusal}
 * calls a refusal, appends a `WaiverExpired` for every waiver armed in
 * the log as it is now, then fails with the refusal. Must run under the
 * project lock. A failed append fails with its own error instead. A
 * defect or an interruption is not a typed failure and expires nothing.
 */
export const expiringOnRefusal = <A, E extends AttemptStop, R>(
  context: SessionContext,
  attempt: Effect.Effect<A, E, R>,
) => Effect.tapError(attempt, (error) => (isRefusal(error) ? expireArmed(context) : Effect.void))

/** Appends a `WaiverExpired` for every armed waiver, if any. */
const expireArmed = (context: SessionContext) =>
  Effect.gen(function* () {
    const read = yield* readLog(context.capabilities.log)
    const expiries = expiriesBeside(foldSession(read.events).armedWaivers, Option.none())
    if (Arr.isReadonlyArrayNonEmpty(expiries)) yield* context.capabilities.log.append(read.position, expiries)
  })
