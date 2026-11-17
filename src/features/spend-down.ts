// Spend-down (design "Spend-down override", claim C15). `spend-down`
// appends `SpendDown(provider, window, level, periodSeq)`; it is accepted
// only with a usable reading and no active spend-down on the window. While
// active, rule 1 uses `level` as the window's cap. A level above
// `100 - reserve` loosens, and rule 2 is skipped for that window; at or
// below, it tightens and rule 2 stays in force.
//
// A spend-down is active only while the window's current period is its
// `periodSeq` and no `SpendDownCanceled` names it. A loosening one also
// ends when the wall clock reaches the period's reset time, since ending
// it tightens; a tightening one never ends on the clock.
import { Array as Arr, Option, Schema } from "effect"
import type { Client } from "../domain/clients.ts"
import type { LedgerSeq, PeriodSeq } from "../domain/ids.ts"
import { type LedgerSnapshot, SpendDown, SpendDownCanceled } from "../domain/ledger.ts"
import type { Policy } from "../domain/policy.ts"
import type { Window } from "../domain/window.ts"
import { defaultCap } from "./pace.ts"

/** The parts of a window's current period a spend-down depends on. */
export interface PeriodRef {
  readonly periodSeq: PeriodSeq
  readonly resetsAt: Option.Option<number>
}

/** Whether `snapshot` has a cancel of the spend-down written at `seq`. */
const isCanceled = (snapshot: LedgerSnapshot, seq: LedgerSeq) =>
  Arr.some(
    snapshot.entries,
    (entry) => Schema.is(SpendDownCanceled)(entry.row) && entry.row.spendDownSeq === seq,
  )

/** Whether `spendDown` loosens: its level is above `100 - reserve`. */
const loosens = (spendDown: SpendDown, policy: Policy) =>
  spendDown.levelPercent > defaultCap(policy, spendDown.provider)(spendDown.window)

/** Whether a loosening spend-down's period reset time has been reached. */
const pastReset = (period: PeriodRef, now: number) =>
  Option.exists(period.resetsAt, (resetsAt) => now >= resetsAt)

/**
 * The spend-down active on `provider`'s `window`: the latest one written
 * for the window's current period, not canceled, and (if it loosens) with
 * the period's reset time still ahead. None without a current period.
 */
export const activeSpendDown = (
  snapshot: LedgerSnapshot,
  provider: Client,
  window: Window,
  period: Option.Option<PeriodRef>,
  now: number,
  policy: Policy,
): Option.Option<SpendDown> =>
  Option.flatMap(period, (current) =>
    Option.flatMap(
      Arr.findLast(
        snapshot.entries,
        (entry) =>
          Schema.is(SpendDown)(entry.row) &&
          entry.row.provider === provider &&
          entry.row.window === window &&
          entry.row.periodSeq === current.periodSeq,
      ),
      (entry) =>
        Schema.is(SpendDown)(entry.row) &&
        !isCanceled(snapshot, entry.seq) &&
        !(loosens(entry.row, policy) && pastReset(current, now))
          ? Option.some(entry.row)
          : Option.none(),
    ),
  )

/**
 * The cap per window for `provider`: an active spend-down's level, else
 * `100 - reserve`. Feeds `PaceInput.cap`.
 */
export const capFor =
  (
    snapshot: LedgerSnapshot,
    provider: Client,
    periodOf: (window: Window) => Option.Option<PeriodRef>,
    now: number,
    policy: Policy,
  ) =>
  (window: Window): number =>
    Option.match(activeSpendDown(snapshot, provider, window, periodOf(window), now, policy), {
      onNone: () => defaultCap(policy, provider)(window),
      onSome: (spendDown) => spendDown.levelPercent,
    })

/** Whether rule 2 is skipped for the window: only under a loosening spend-down. */
export const skipsAllocations = (
  snapshot: LedgerSnapshot,
  provider: Client,
  window: Window,
  period: Option.Option<PeriodRef>,
  now: number,
  policy: Policy,
): boolean =>
  Option.exists(activeSpendDown(snapshot, provider, window, period, now, policy), (spendDown) =>
    loosens(spendDown, policy),
  )

/**
 * Whether `spend-down` is accepted: the window has a usable reading and no
 * spend-down is active on it.
 */
export const spendDownAccepted = (
  usable: boolean,
  active: Option.Option<SpendDown>,
): boolean => usable && Option.isNone(active)
