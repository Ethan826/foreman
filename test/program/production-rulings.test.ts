// `ruling add` and `overrule` through the CLI's `main` over the
// production composition (v0.2.0, dogfood-6b, owner ruling 8): each
// prints the event it appended as JSON, a blank text is a usage error
// (exit 2) that appends nothing, a refusal exits 1, and `status` prints
// the session's rulings with their supersede marks and the overrules of
// each review, a re-review's overrule of a repeated finding id beside
// the first review's.
import { describe, expect, it } from "@effect/vitest"
import { Array as Arr, Effect, Formatter, Option, Schema } from "effect"
import { FindingOverruled, RulingAdded } from "../../src/domain/events.ts"
import { OpId, RulingId } from "../../src/domain/ids.ts"
import { OverruledFinding, Ruling } from "../../src/domain/rulings.ts"
import { twoFindingsReviewMessage } from "../fixtures/clients/codex-review-two-findings.ts"
import { cli, type CliRun, endToEndMillis, openedSession, succeeded, withLayout } from "./production-harness.ts"

const id = (n: number) => RulingId.make(`R${String(n)}`)

/** What a run printed on stdout, decoded by `schema` from its JSON. */
const printedAs = <A, I>(schema: Schema.Codec<A, I>, run: CliRun) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(Arr.join(run.out, "\n"))

/** `value` encoded by `schema` and laid out as the CLI prints it, read back as plain JSON. */
const asPrinted = <A, I>(schema: Schema.Codec<A, I>, value: A) =>
  Effect.flatMap(Schema.encodeEffect(schema)(value), (encoded) =>
    Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(Formatter.formatJson(encoded, { space: 2 })),
  )

/** The part of the printed status these tests read. */
const Shown = Schema.Struct({ report: Schema.Struct({ state: Schema.Unknown }) })

const note = "A name is not asked for."

const printedAndShown = () =>
  withLayout((layout) =>
    Effect.gen(function* () {
      yield* openedSession(layout)
      yield* succeeded(layout, ["implement", "--waive"])
      yield* succeeded(layout, ["review", "--waive", "--attest"], { env: { FAKE_MESSAGE: twoFindingsReviewMessage } })
      const first = yield* printedAs(RulingAdded, yield* succeeded(layout, ["ruling", "add", "--text", "Keep it short."]))
      expect([first.rulingId, first.text, first.supersedes]).toEqual([id(1), "Keep it short.", Option.none()])
      const over = yield* printedAs(FindingOverruled, yield* succeeded(layout, ["overrule", "F2", "--note", note]))
      expect([over.findingId, over.rulingId, over.note]).toEqual(["F2", id(2), note])
      const blank = yield* cli(layout, ["ruling", "add", "--text", " "])
      expect([blank.status, blank.out]).toEqual([2, []])
      expect(Arr.join(blank.err, "\n")).toContain("--text must not be empty")
      const emptyNote = yield* cli(layout, ["overrule", "F1", "--note", ""])
      expect([emptyNote.status, emptyNote.out]).toEqual([2, []])
      const unknown = yield* cli(layout, ["overrule", "F9", "--note", "Why."])
      expect(unknown.status).toBe(1)
      expect(Arr.join(unknown.err, "\n")).toContain("FindingNotRecorded")
      const third = yield* printedAs(
        RulingAdded,
        yield* succeeded(layout, ["ruling", "add", "--text", "Names are fine.", "--supersedes", "R2"]),
      )
      expect([third.rulingId, third.supersedes]).toEqual([id(3), Option.some(id(2))])
      yield* succeeded(layout, ["review", "--waive", "--attest"], { env: { FAKE_MESSAGE: twoFindingsReviewMessage } })
      const again = yield* printedAs(FindingOverruled, yield* succeeded(layout, ["overrule", "F2", "--note", note]))
      expect([again.findingId, again.rulingId]).toEqual(["F2", id(4)])
      expect(again.reviewOpId).not.toBe(over.reviewOpId)
      const status = yield* succeeded(layout, ["status"])
      const shown = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Shown))(Arr.join(status.out, "\n"))
      const rulings = yield* asPrinted(Schema.Array(Ruling), [
        { id: id(1), text: "Keep it short.", supersedes: Option.none(), supersededBy: Option.none() },
        {
          id: id(2),
          text: `Finding F2 of review ${over.reviewOpId} is overruled: ${note} (the finding: The greeting lacks a name.)`,
          supersedes: Option.none(),
          supersededBy: Option.some(id(3)),
        },
        { id: id(3), text: "Names are fine.", supersedes: Option.some(id(2)), supersededBy: Option.none() },
        {
          id: id(4),
          text: `Finding F2 of review ${again.reviewOpId} is overruled: ${note} (the finding: The greeting lacks a name.)`,
          supersedes: Option.none(),
          supersededBy: Option.none(),
        },
      ])
      const overrules = yield* asPrinted(Schema.Array(OverruledFinding), [
        { reviewOpId: OpId.make(over.reviewOpId), findingId: "F2", rulingId: id(2) },
        { reviewOpId: OpId.make(again.reviewOpId), findingId: "F2", rulingId: id(4) },
      ])
      expect(shown.report.state).toMatchObject({ _tag: "AwaitingHandoff", session: { rulings, overrules } })
    }),
  )

describe("ruling add and overrule through the CLI", () => {
  it.effect("print their events, refuse blank texts as usage errors, and show in status", printedAndShown, endToEndMillis)
})
