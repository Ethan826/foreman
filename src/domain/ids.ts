// Validated identifiers (design "Architecture (S9)": TrancheId, OpId,
// Revision, WaiverId). Every value that exists is valid by construction.
//
// Guess to confirm: the design names these identifiers but not their
// shape. TrancheId, OpId and WaiverId are short slugs (letters, digits,
// dot, underscore, hyphen; 1 to 64 characters; first character a letter or
// digit) so that they are safe in file names, log lines and CLI arguments.
// Revision is a lowercase hexadecimal git object id of 40 (SHA-1) or 64
// (SHA-256) digits.
import { Schema } from "effect"

const slug = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
)

export const TrancheId = slug.pipe(Schema.brand("TrancheId"))
export type TrancheId = typeof TrancheId.Type

export const OpId = slug.pipe(Schema.brand("OpId"))
export type OpId = typeof OpId.Type

export const WaiverId = slug.pipe(Schema.brand("WaiverId"))
export type WaiverId = typeof WaiverId.Type

export const Revision = Schema.String.check(
  Schema.isPattern(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
).pipe(Schema.brand("Revision"))
export type Revision = typeof Revision.Type

// Ledger order and periods (design "Where the ledger lives", "Periods").
// A `seq` is assigned inside the ledger's write transaction, so seq order is
// commit order across every table. Both start at 1.
const positiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))

export const LedgerSeq = positiveInt.pipe(Schema.brand("LedgerSeq"))
export type LedgerSeq = typeof LedgerSeq.Type

export const PeriodSeq = positiveInt.pipe(Schema.brand("PeriodSeq"))
export type PeriodSeq = typeof PeriodSeq.Type

export const GrantId = slug.pipe(Schema.brand("GrantId"))
export type GrantId = typeof GrantId.Type
