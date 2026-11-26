// Questions about an open session's owner rulings and overrules (v0.2.0
// design, "Commands and events", "Closing after overrules"): the id the
// next ruling takes, the findings a review recorded, which of them are
// overruled, and the text of the ruling an overrule adds. A finding is
// named by its review's opId and its finding id together, since finding
// ids repeat across reviews. Pure; the command rules, the phases and
// Program ask these.
import { Array as Arr, Option } from "effect"
import type { Finding, Findings } from "../domain/findings.ts"
import { type OpId, RulingId } from "../domain/ids.ts"
import type { Ruling } from "../domain/rulings.ts"
import type { OpenSession } from "../domain/session-state.ts"

/**
 * The id the next ruling of `session` takes: `R` and one more than the
 * number of rulings recorded so far, so `R1` first. Every `RulingAdded`
 * of the session counts, those an `overrule` added included (owner
 * ruling 2, dogfood-6b).
 */
export const nextRulingId = (session: OpenSession): RulingId =>
  RulingId.make(`R${String(Arr.length(session.rulings) + 1)}`)

/** The ruling `id` of `session`, if it was recorded. */
export const rulingOf = (session: OpenSession, id: RulingId): Option.Option<Ruling> =>
  Arr.findFirst(session.rulings, (ruling) => ruling.id === id)

/**
 * The findings review `reviewOpId` recorded in `session`, in the
 * reviewer's order. None when the review recorded no `FindingsRecorded`:
 * an unusable review, or one run before dogfood-6.
 */
export const recordedFindings = (session: OpenSession, reviewOpId: OpId): Option.Option<Findings> =>
  Option.map(
    Arr.findLast(session.findings, (recorded) => recorded.reviewOpId === reviewOpId),
    (recorded) => recorded.findings,
  )

/** Finding `findingId` as review `reviewOpId` recorded it, if it did. */
export const recordedFinding = (
  session: OpenSession,
  reviewOpId: OpId,
  findingId: string,
): Option.Option<Finding> =>
  Option.flatMap(recordedFindings(session, reviewOpId), (findings) =>
    Arr.findFirst(findings, (finding) => finding.id === findingId),
  )

/**
 * Whether finding `findingId` of review `reviewOpId` is overruled. The
 * same id in another review does not count. An overrule stands once
 * recorded: superseding its ruling does not undo it (owner ruling,
 * dogfood-6b).
 */
export const isOverruled = (session: OpenSession, reviewOpId: OpId, findingId: string): boolean =>
  Arr.some(session.overrules, (overrule) => overrule.reviewOpId === reviewOpId && overrule.findingId === findingId)

/**
 * Whether review `reviewOpId` recorded at least one finding and every
 * one of them is overruled: the condition under which a review that
 * asked for changes allows `close --finished` (owner ruling 1,
 * 2026-11-25). False for a review with no findings recorded.
 */
export const everyFindingOverruled = (session: OpenSession, reviewOpId: OpId): boolean =>
  Option.exists(
    recordedFindings(session, reviewOpId),
    (findings) =>
      Arr.isReadonlyArrayNonEmpty(findings) &&
      Arr.every(findings, (finding) => isOverruled(session, reviewOpId, finding.id)),
  )

/**
 * Whether at least one finding review `reviewOpId` recorded is overruled:
 * the condition under which `review` may run again on the reviewed tree
 * (design, "Closing after overrules").
 */
export const someFindingOverruled = (session: OpenSession, reviewOpId: OpId): boolean =>
  Option.exists(recordedFindings(session, reviewOpId), (findings) =>
    Arr.some(findings, (finding) => isOverruled(session, reviewOpId, finding.id)),
  )

/**
 * The text of the ruling an overrule adds (owner ruling 3, dogfood-6b):
 * `Finding <id> of review <reviewOpId> is overruled: <note> (the
 * finding: <summary>)`, with the note and the finding's summary exactly
 * as given.
 */
export const overruleText = (reviewOpId: OpId, finding: Finding, note: string): string =>
  `Finding ${finding.id} of review ${reviewOpId} is overruled: ${note} (the finding: ${finding.summary})`
