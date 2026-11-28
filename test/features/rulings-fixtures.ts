// Shared log events for the rulings and overrule tests (v0.2.0,
// dogfood-6b): a review's recorded findings, the owner's rulings and
// overrules. Attempt n has opId op-n, as in session-fixtures.ts; ruling
// n has id Rn.
import { Array as Arr, Option } from "effect"
import {
  FindingOverruled,
  FindingsRecorded,
  type ProjectEvent,
  RoundsGranted,
  RulingAdded,
} from "../../src/domain/events.ts"
import type { Finding } from "../../src/domain/findings.ts"
import { RulingId } from "../../src/domain/ids.ts"
import type { SessionId } from "../../src/domain/session.ts"
import { opId, sessionId } from "./session-fixtures.ts"

/** The owner's grant of `count` more correction rounds to session `id` (dogfood-7). */
export const granted = (count: number, id: SessionId = sessionId) =>
  new RoundsGranted({ sessionId: id, count, note: `${String(count)} more.` })

/** Ruling id `Rn`. */
export const rulingId = (n: number) => RulingId.make(`R${String(n)}`)

/** Finding `id`, with a summary that names it. */
export const finding = (id: string): Finding => ({
  id,
  severity: "major",
  file: Option.none(),
  summary: `The summary of ${id}.`,
})

/** Review n's `FindingsRecorded`, with findings of these ids in this order. */
export const recorded = (n: number, ids: ReadonlyArray<string>) =>
  new FindingsRecorded({ sessionId, reviewOpId: opId(n), findings: Arr.map(ids, finding) })

/** Ruling `Rn`, superseding `supersedes` if given. */
export const ruled = (n: number, supersedes: Option.Option<number> = Option.none()) =>
  new RulingAdded({
    sessionId,
    rulingId: rulingId(n),
    text: `Ruling ${String(n)}.`,
    supersedes: Option.map(supersedes, rulingId),
  })

/**
 * The batch `overrule` appends for finding `findingId` of review n with
 * ruling `Rm`: its `RulingAdded`, then its `FindingOverruled`.
 */
export const overruled = (n: number, findingId: string, m: number): ReadonlyArray<ProjectEvent> => [
  ruled(m),
  new FindingOverruled({ sessionId, reviewOpId: opId(n), findingId, rulingId: rulingId(m), note: "Not a defect." }),
]
