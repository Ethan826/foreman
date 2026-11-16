// Validated identifiers (design "Architecture (S9)": TrancheId, OpId,
// Revision, WaiverId). Every value that exists is valid by construction.
//
// Guess to confirm: the design names these identifiers but not their shape.
import { Schema } from "effect"

// A short slug: letters, digits, dot, underscore and hyphen, 1 to 64
// characters, the first a letter or digit. Safe in file names, log lines
// and CLI arguments.
const slug = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
)

/** Identifies a tranche of work. A slug of 1 to 64 characters (guess to confirm). */
export const TrancheId = slug.pipe(Schema.brand("TrancheId"))
/** A tranche id; see {@link TrancheId}. */
export type TrancheId = typeof TrancheId.Type

/** Identifies one operation. A slug of 1 to 64 characters (guess to confirm). */
export const OpId = slug.pipe(Schema.brand("OpId"))
/** An operation id; see {@link OpId}. */
export type OpId = typeof OpId.Type

/** Identifies a waiver. A slug of 1 to 64 characters (guess to confirm). */
export const WaiverId = slug.pipe(Schema.brand("WaiverId"))
/** A waiver id; see {@link WaiverId}. */
export type WaiverId = typeof WaiverId.Type

/**
 * A git object id in lowercase hexadecimal: 40 digits (SHA-1) or 64
 * digits (SHA-256).
 */
export const Revision = Schema.String.check(
  Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
).pipe(Schema.brand("Revision"))
/** A git object id; see {@link Revision}. */
export type Revision = typeof Revision.Type

const positiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

/**
 * A ledger sequence number, starting at 1 (design "Where the ledger
 * lives"). It is assigned inside the ledger's write transaction, so seq
 * order is commit order across every table.
 */
export const LedgerSeq = positiveInt.pipe(Schema.brand("LedgerSeq"))
/** A ledger sequence number; see {@link LedgerSeq}. */
export type LedgerSeq = typeof LedgerSeq.Type

/** Numbers the periods of one provider window, starting at 1 (design "Periods"). */
export const PeriodSeq = positiveInt.pipe(Schema.brand("PeriodSeq"))
/** A period number; see {@link PeriodSeq}. */
export type PeriodSeq = typeof PeriodSeq.Type

/** Identifies a grant. A slug of 1 to 64 characters (guess to confirm). */
export const GrantId = slug.pipe(Schema.brand("GrantId"))
/** A grant id; see {@link GrantId}. */
export type GrantId = typeof GrantId.Type
