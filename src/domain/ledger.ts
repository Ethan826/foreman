// The shared usage ledger's records and the capability that stores them
// (design "Usage ledger", "Where the ledger lives and how instances
// coordinate", "Grant lifecycle"). The ledger is append-only: one table per
// record kind, and a ledger-wide `seq` assigned inside each write
// transaction orders every row of every table. Rows here carry no `seq`;
// a stored row is read back as a `LedgerEntry` that pairs it with its seq.
import { Record, Schema, Struct } from "effect"
import type { Effect } from "effect"
import { Client } from "./clients.ts"
import { GrantCancelCause } from "./grant.ts"
import { GrantId, LedgerSeq, OpId, PeriodSeq, ProjectId } from "./ids.ts"
import { Observation, wholeWindowPercent } from "./observation.ts"
import { Window } from "./window.ts"

/** The ledger's record kinds, which are also the row tags. */
export const LedgerRowKinds = {
  Grant: "Grant",
  Charged: "Charged",
  GrantCanceled: "GrantCanceled",
  ReadingRow: "ReadingRow",
  PeriodOpened: "PeriodOpened",
  Reserve: "Reserve",
  Allocation: "Allocation",
  SpendDown: "SpendDown",
  SpendDownCanceled: "SpendDownCanceled",
  Retirement: "Retirement",
  RateUpdated: "RateUpdated",
} as const

const points = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0))
const epochMillis = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const percent = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: wholeWindowPercent }),
)

/** Points (percentage points of a window) attributed to one window. */
export const WindowPoints = Schema.Struct({ window: Window, points })
/** Points for one window; see {@link WindowPoints}. */
export type WindowPoints = typeof WindowPoints.Type

/**
 * A reservation made at admission: the launch's estimate per window, for
 * operation `opId` of `project`. It counts until it is canceled or retired
 * (design "Grant lifecycle"; retirement is the owner's, choice 1).
 */
export class Grant extends Schema.TaggedClass<Grant>()(LedgerRowKinds.Grant, {
  grantId: GrantId,
  project: ProjectId,
  opId: OpId,
  provider: Client,
  points: Schema.Array(WindowPoints),
  issuedAt: epochMillis,
}) {}

/**
 * Settles a grant whose step ended, at `endedAt` (wall clock). The amount
 * per window is the grant's estimate: no run report gives an authoritative
 * measurement in the quota's units. At most one per grant, and never for a
 * canceled grant.
 */
export class Charged extends Schema.TaggedClass<Charged>()(
  LedgerRowKinds.Charged,
  { grantId: GrantId, endedAt: epochMillis, points: Schema.Array(WindowPoints) },
) {}

/**
 * Settles a grant whose step never launched: an orphan (no `Intended`
 * names it) or a lost compare-and-append race. At most one per grant, and
 * never for a charged grant. A canceled grant counts nothing.
 */
export class GrantCanceled extends Schema.TaggedClass<GrantCanceled>()(
  LedgerRowKinds.GrantCanceled,
  { grantId: GrantId, cause: GrantCancelCause },
) {}

/**
 * A usage reading as stored: an {@link Observation} without its seq, which
 * the ledger assigns when the row is written.
 */
export class ReadingRow extends Schema.TaggedClass<ReadingRow>()(
  LedgerRowKinds.ReadingRow,
  Struct.omit(Observation.fields, ["seq"]),
) {}

/** Records that a reading opened period `periodSeq` of a provider window. */
export class PeriodOpened extends Schema.TaggedClass<PeriodOpened>()(
  LedgerRowKinds.PeriodOpened,
  {
    provider: Client,
    window: Window,
    periodSeq: PeriodSeq,
    resetsAt: Schema.OptionFromOptionalKey(epochMillis),
  },
) {}

/** The reserve for a provider window, in percent of the window. */
export class Reserve extends Schema.TaggedClass<Reserve>()(
  LedgerRowKinds.Reserve,
  { provider: Client, window: Window, reservePercent: percent },
) {}

/** A project's allocation of a provider window, in percent (rule 2). */
export class Allocation extends Schema.TaggedClass<Allocation>()(
  LedgerRowKinds.Allocation,
  { project: ProjectId, provider: Client, window: Window, percent },
) {}

/**
 * The owner's spend-down: the cap of a provider window for one period is
 * `levelPercent` instead of `100 - reserve` (design "Spend-down override").
 */
export class SpendDown extends Schema.TaggedClass<SpendDown>()(
  LedgerRowKinds.SpendDown,
  { provider: Client, window: Window, levelPercent: percent, periodSeq: PeriodSeq },
) {}

/**
 * Why a spend-down ended early: the owner's `spend-down --cancel`, or a
 * loosening spend-down whose period's reset time foreman observed passed.
 */
export const SpendDownEndCauses = {
  Owner: "owner",
  ResetPassed: "resetPassed",
} as const

/** Schema for a spend-down end cause, one of {@link SpendDownEndCauses}. */
export const SpendDownEndCause = Schema.Literals(Record.values(SpendDownEndCauses))
/** A spend-down end cause; see {@link SpendDownEndCauses}. */
export type SpendDownEndCause = typeof SpendDownEndCause.Type

/**
 * Ends the spend-down written at `spendDownSeq`, for good: once written,
 * no clock reading brings it back (review finding F5).
 */
export class SpendDownCanceled extends Schema.TaggedClass<SpendDownCanceled>()(
  LedgerRowKinds.SpendDownCanceled,
  { provider: Client, window: Window, spendDownSeq: LedgerSeq, cause: SpendDownEndCause },
) {}

/**
 * The owner's `ledger retire`: every grant of the provider window written
 * at or before `throughSeq` stops counting. An attestation, not
 * independently verified evidence (design "Reconciling readings, grants
 * and charges").
 */
export class Retirement extends Schema.TaggedClass<Retirement>()(
  LedgerRowKinds.Retirement,
  { provider: Client, window: Window, throughSeq: LedgerSeq },
) {}

/** A rate-fit update for a provider window (used by rule 2, Task B17). */
export class RateUpdated extends Schema.TaggedClass<RateUpdated>()(
  LedgerRowKinds.RateUpdated,
  {
    provider: Client,
    window: Window,
    pointsPerToken: points,
    pairs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  },
) {}

/** Any ledger row, tagged by its {@link LedgerRowKinds} kind. */
export const LedgerRow = Schema.Union([
  Grant,
  Charged,
  GrantCanceled,
  ReadingRow,
  PeriodOpened,
  Reserve,
  Allocation,
  SpendDown,
  SpendDownCanceled,
  Retirement,
  RateUpdated,
])
/** Any ledger row; see {@link LedgerRow}. */
export type LedgerRow = typeof LedgerRow.Type

/** A stored row with the ledger-wide sequence number it was written at. */
export interface LedgerEntry {
  readonly seq: LedgerSeq
  readonly row: LedgerRow
}

/** Every stored row, in seq order (the order transactions committed). */
export interface LedgerSnapshot {
  readonly entries: ReadonlyArray<LedgerEntry>
}

/** The ledger could not be read or written (I/O, schema or decode). */
export class LedgerError extends Schema.TaggedError<LedgerError>()(
  "LedgerError",
  { reason: Schema.String },
) {}

/**
 * Another writer held the ledger's write lock past `busy_timeout`. The
 * transaction wrote nothing; the launch attempt ends and the next one
 * tries again.
 */
export class LedgerBusy extends Schema.TaggedError<LedgerBusy>()(
  "LedgerBusy",
  {},
) {}

/**
 * A charge for a canceled grant, or a cancel for a charged one. A grant is
 * settled by exactly one of the two; the transaction writes nothing.
 */
export class GrantSettled extends Schema.TaggedError<GrantSettled>()(
  "GrantSettled",
  { grantId: GrantId },
) {}

/** What a write transaction can do: read every row, and append rows. */
export interface LedgerTx {
  /** Every stored row, including those this transaction appended. */
  readonly read: Effect.Effect<LedgerSnapshot, LedgerError>
  /**
   * Appends rows and returns the seqs written. A second charge or cancel
   * of a grant is skipped (no seq); a charge of a canceled grant or a
   * cancel of a charged one fails with {@link GrantSettled}.
   */
  readonly append: (
    rows: ReadonlyArray<LedgerRow>,
  ) => Effect.Effect<ReadonlyArray<LedgerSeq>, LedgerError | GrantSettled>
}

/**
 * The ledger as a capability. `transact` runs `body` inside one write
 * transaction (`BEGIN IMMEDIATE`): it commits if `body` succeeds and rolls
 * back, writing nothing, if `body` fails.
 */
export interface LedgerStore {
  readonly transact: <A, E>(
    body: (tx: LedgerTx) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | LedgerBusy | LedgerError>
}

/** The row kinds' names, for building the store's tables. */
export const ledgerRowKindNames: ReadonlyArray<string> = Record.values(LedgerRowKinds)
