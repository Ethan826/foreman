// Facts a launch command decides with (plan "Commands and their
// prerequisites", "Write protocol" step 3): whether the installed client
// is the pinned one, which holds are in place once readings have released
// a quota hold, and the quota hold that pacing's refusal creates. Pure;
// Program reads the inputs and writes what these return.
import { Array as Arr, Option, Schema, String } from "effect"
import type { Client } from "../domain/clients.ts"
import type { MonoStamp } from "../domain/clock.ts"
import type { LoggedEvent } from "../domain/events.ts"
import { type Hold, Quota } from "../domain/holds.ts"
import { LedgerSeq } from "../domain/ids.ts"
import type { LedgerSnapshot } from "../domain/ledger.ts"
import type { Window } from "../domain/window.ts"
import { type AdmissionContext, type AllocationRefused, readingsOf, Refused } from "./admission.ts"
import { counting } from "./counting.ts"
import { holdsOf, quotaReleased } from "./holds.ts"
import { currentPeriod } from "./periods.ts"
import { capFor } from "./spend-down.ts"

/** What a finished `<client> --version` printed and its exit code. */
export interface VersionReading {
  readonly exitCode: number
  readonly stdout: string
}

/** What deciding whether readings release a quota hold needs. */
export interface ReleaseInput {
  /** Wall clock, epoch milliseconds. */
  readonly now: number
  readonly nowMono: Option.Option<MonoStamp>
  readonly context: AdmissionContext
  /** The next step's estimate in points for a provider's launch. */
  readonly estimate: (provider: Client) => number
}

/**
 * Whether the installed client is the pinned one (decision P4): the
 * version command exited 0 and its output, trimmed, equals the pin
 * exactly. Any other output, including a newer version, does not match.
 */
export const pinMatches = (pin: string, reading: VersionReading): boolean =>
  reading.exitCode === 0 && String.trim(reading.stdout) === pin

/**
 * The holds the log leaves in place (`holdsOf`), less every quota hold
 * that readings release (`quotaReleased`, design "Holds (S7)"): such a
 * hold is treated as absent, as at every launch attempt.
 */
export const holdsInPlace = (
  log: ReadonlyArray<LoggedEvent>,
  snapshot: LedgerSnapshot,
  input: ReleaseInput,
): ReadonlyArray<Hold> => Arr.filter(holdsOf(log), (hold) => !releasedByReadings(hold, snapshot, input))

/**
 * The quota hold batch Q records when pacing refuses a launch for
 * `provider` (write protocol, step 3): the windows pacing named (none for
 * a refusal by the allocation rule), the monotonic clock now, and the
 * ledger's last seq, so only a later reading counts toward its release.
 * On an empty ledger the seq is 1, the lowest a seq can be, which can
 * only delay a release.
 */
export const quotaHoldFor = (
  provider: Client,
  refusal: Refused | AllocationRefused,
  snapshot: LedgerSnapshot,
  heldMono: Option.Option<MonoStamp>,
): Quota =>
  new Quota({
    provider,
    windows: windowsOf(refusal),
    heldMono,
    ledgerSeq: Option.getOrElse(
      Option.map(Arr.last(snapshot.entries), (entry) => entry.seq),
      () => LedgerSeq.make(1),
    ),
  })

/** The windows a refusal names: pacing's, or none for the allocation rule. */
const windowsOf = (refusal: Refused | AllocationRefused): ReadonlyArray<Window> =>
  Schema.is(Refused)(refusal) ? refusal.decision.windows : []

/** Whether `hold` is a quota hold that readings release now. */
const releasedByReadings = (hold: Hold, snapshot: LedgerSnapshot, input: ReleaseInput): boolean =>
  Schema.is(Quota)(hold) && quotaReleased(hold, paceInputFor(hold.provider, snapshot, input))

/** Pacing's input for `provider`, built as admission builds it. */
const paceInputFor = (provider: Client, snapshot: LedgerSnapshot, input: ReleaseInput) => {
  const { policy } = input.context
  const readings = readingsOf(snapshot)
  const periodOf = (window: Window) => currentPeriod(readings, provider, window, policy)
  return {
    readings,
    now: input.now,
    nowMono: input.nowMono,
    policy,
    provider,
    estimate: () => input.estimate(provider),
    counting: counting(snapshot, provider, input.context.retirement),
    cap: capFor(snapshot, provider, periodOf, input.now, policy),
  }
}
