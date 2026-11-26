// The owner's rulings of an assisted session (v0.2.0 design, "Commands
// and events", "Briefs"): each ruling as the fold keeps it and every
// brief lists it, and the overrules the owner recorded against a review's
// findings. Features folds them from `RulingAdded` and `FindingOverruled`;
// Format renders them in the briefs.
import { Schema } from "effect"
import { OpId, RulingId } from "./ids.ts"

const nonEmpty = Schema.String.check(Schema.isNonEmpty())

/**
 * One ruling of the session: its `id`, its `text` as the owner gave it
 * (or as `overrule` composed it), the earlier ruling it `supersedes`, if
 * any, and the later ruling that superseded it, `supersededBy`, if any. A
 * superseded ruling stays listed, marked, in every later brief.
 */
export const Ruling = Schema.Struct({
  id: RulingId,
  text: nonEmpty,
  supersedes: Schema.Option(RulingId),
  supersededBy: Schema.Option(RulingId),
})
/** A ruling; see {@link Ruling}. */
export type Ruling = typeof Ruling.Type

/**
 * One overruled finding: finding `findingId` of review `reviewOpId`,
 * overruled by ruling `rulingId`. Finding ids repeat across reviews, so
 * the review and the finding id together name the finding. An overrule
 * stands once recorded, whatever later supersedes its ruling (owner
 * ruling, dogfood-6b).
 */
export const OverruledFinding = Schema.Struct({
  reviewOpId: OpId,
  findingId: nonEmpty,
  rulingId: RulingId,
})
/** An overruled finding; see {@link OverruledFinding}. */
export type OverruledFinding = typeof OverruledFinding.Type
