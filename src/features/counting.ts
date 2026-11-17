// Which grants count toward a window's level (design "Reconciling readings,
// grants and charges", rule P as of revision 5.2, and "Accounting choices
// for decision" in the implementation plan). A grant counts from its
// `Grant` row until it is canceled or retired: an open grant at its
// estimate, a charged grant at its charged amount. A new period, a passed
// reset time or a usage drop retires nothing.
//
// Retirement is injected as a `RetirementRule`, so the owner's accounting
// choice changes one value where the program is wired, never a flag.
// `ownerOnly` is choice 1, the provisional baseline: only the owner's
// `ledger retire` (a `Retirement` row) retires a grant. That row is an
// attestation, not independently verified evidence.
import { Array as Arr, Option, Schema } from "effect"
import type { Client } from "../domain/clients.ts"
import type { GrantPoints } from "../domain/grant.ts"
import type { GrantId, LedgerSeq } from "../domain/ids.ts"
import {
  Charged,
  Grant,
  GrantCanceled,
  type LedgerEntry,
  type LedgerSnapshot,
  Retirement,
  type WindowPoints,
} from "../domain/ledger.ts"
import type { Window } from "../domain/window.ts"

/**
 * A grant as the ledger records it: the `Grant` row with its seq, its
 * charge if one was written, and whether it was canceled.
 */
export interface GrantView {
  readonly seq: LedgerSeq
  readonly grant: Grant
  readonly charge: Option.Option<Charged>
  readonly canceled: boolean
}

/**
 * Whether a grant no longer counts for `window`. Injected so the owner's
 * accounting choice is one value in Program.
 */
export type RetirementRule = (
  view: GrantView,
  window: Window,
  snapshot: LedgerSnapshot,
) => boolean

/** Whether `entry` is a retirement of `window` for `provider` covering `seq`. */
const retires =
  (provider: Client, window: Window, seq: LedgerSeq) =>
  (entry: LedgerEntry): boolean =>
    Schema.is(Retirement)(entry.row) &&
    entry.row.provider === provider &&
    entry.row.window === window &&
    seq <= entry.row.throughSeq

/**
 * Choice 1 (provisional): a grant is retired for a window only by a
 * `Retirement` row of the grant's provider and that window whose
 * `throughSeq` is at or after the grant's seq.
 */
export const ownerOnly: RetirementRule = (view, window, snapshot) =>
  Arr.some(snapshot.entries, retires(view.grant.provider, window, view.seq))

/** The first charge of `grantId` in the snapshot. */
const chargeOf = (snapshot: LedgerSnapshot, grantId: GrantId): Option.Option<Charged> =>
  Arr.findFirst(
    Arr.flatMap(snapshot.entries, (e) => (Schema.is(Charged)(e.row) ? [e.row] : [])),
    (charge) => charge.grantId === grantId,
  )

/** Whether the snapshot has a cancel of `grantId`. */
const isCanceled = (snapshot: LedgerSnapshot, grantId: GrantId): boolean =>
  Arr.some(snapshot.entries, (e) => Schema.is(GrantCanceled)(e.row) && e.row.grantId === grantId)

/** Every grant in the snapshot with its settlement, in seq order. */
export const grantViews = (snapshot: LedgerSnapshot): ReadonlyArray<GrantView> =>
  Arr.flatMap(snapshot.entries, (entry): ReadonlyArray<GrantView> =>
    Schema.is(Grant)(entry.row)
      ? [
          {
            seq: entry.seq,
            grant: entry.row,
            charge: chargeOf(snapshot, entry.row.grantId),
            canceled: isCanceled(snapshot, entry.row.grantId),
          },
        ]
      : [],
  )

/** The points a view counts for one of its windows: charged, else estimated. */
const pointsFor = (view: GrantView, estimate: WindowPoints): number =>
  Option.match(view.charge, {
    onNone: () => estimate.points,
    onSome: (charge) =>
      Option.match(
        Arr.findFirst(charge.points, (p) => p.window === estimate.window),
        { onNone: () => estimate.points, onSome: (p) => p.points },
      ),
  })

/** The windows of one view that still count, as grant points. */
const countedWindows =
  (snapshot: LedgerSnapshot, rule: RetirementRule) =>
  (view: GrantView): ReadonlyArray<GrantPoints> =>
    Arr.flatMap(view.grant.points, (estimate): ReadonlyArray<GrantPoints> =>
      rule(view, estimate.window, snapshot)
        ? []
        : [
            {
              grantId: view.grant.grantId,
              provider: view.grant.provider,
              window: estimate.window,
              points: pointsFor(view, estimate),
            },
          ],
    )

/**
 * The points of every grant of `provider`, from every project, that counts:
 * not canceled and not retired by `rule`, per window. Open grants count at
 * their estimate and charged grants at their charged amount (a window the
 * charge omits keeps the estimate).
 */
export const counting = (
  snapshot: LedgerSnapshot,
  provider: Client,
  rule: RetirementRule,
): ReadonlyArray<GrantPoints> =>
  Arr.flatMap(
    Arr.filter(grantViews(snapshot), (view) => !view.canceled && view.grant.provider === provider),
    countedWindows(snapshot, rule),
  )
